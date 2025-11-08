import { Command } from "commander";

import { loadConfig } from "../config/loader.js";
import { CacheMetrics } from "../core/cache/metrics.js";
import { RedisCache } from "../core/cache/redis-cache.js";
import { MossClient, type SearchResponse } from "../core/indexer/moss-client.js";
import { QueryRouter } from "../core/query/query-router.js";
import { createMcpServer, startHttpTransport } from "../core/mcp/index.js";
import { logger } from "../utils/logger.js";
import {
  requireRepoName,
  RepoNameNotConfiguredError
} from "../utils/repo-name-store.js";

export function registerServeCommand(
  program: Command,
  metrics: CacheMetrics
): void {
  program
    .command("serve")
    .description("Start MCP server")
    .action(async () => {
      const config = await loadConfig();
      const repoRoot = process.cwd();

      // Initialize Moss client - try backend first, fallback to config/env
      const indexDir = config.moss?.index_directory || ".scout-code/indexes";
      let client: MossClient;
      try {
        client = await MossClient.fromBackend(indexDir);
        logger.debug("Moss client initialized with backend credentials");
      } catch (error) {
        // Fallback to config/env if backend fetch fails
        logger.debug("Failed to fetch credentials from backend, using config/env fallback");
        const projectId = config.moss?.project_id;
        const projectKey = config.moss?.project_key;
        client = new MossClient(projectId, projectKey, indexDir);
      }

      // Health check
      const healthy = await client.health();
      if (!healthy) {
        logger.warn(
          "Moss indexer initialization warning. Ensure indexes exist before querying."
        );
      } else {
        logger.info("Moss client initialized successfully.");
      }

      const cache = new RedisCache<SearchResponse>({
        url: config.cache.redis_url,
        defaultTtlSeconds: config.cache.default_ttl
      });

      try {
        await cache.connect();
        const redisUrl = new URL(config.cache.redis_url);
        const redisPath = redisUrl.pathname.replace(/^\//, "");
        const credentials = redisUrl.username ? `${redisUrl.username}@` : "";
        const displayEndpoint = `${redisUrl.protocol}//${credentials}${
          redisUrl.host
        }${redisPath ? `/${redisPath}` : ""}`;
        logger.info(`Connected to Redis cache at ${displayEndpoint}.`);
      } catch (error) {
        logger.error(
          `Failed to connect to Redis cache: ${(error as Error).message}`
        );
        throw error;
      }

      let repoName: string;
      try {
        repoName = await requireRepoName(repoRoot);
      } catch (error) {
        if (error instanceof RepoNameNotConfiguredError) {
          logger.error(error.message);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
      const router = new QueryRouter(client, cache, metrics, repoName);
      const mcpServer = createMcpServer(router, config);
      const transport = await startHttpTransport(mcpServer);

      logger.info(`MCP server listening at ${transport.url}`);
    });
}
