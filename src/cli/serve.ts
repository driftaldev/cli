import { Command } from "commander";

import { loadConfig } from "../config/loader.js";
import { CacheMetrics } from "../core/cache/metrics.js";
import { MossClient } from "../core/indexer/moss-client.js";
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

      // Initialize Moss client using credentials from config
      const client = new MossClient(
        config.moss.project_id,
        config.moss.project_key,
        config.moss.index_directory
      );
      logger.debug("Moss client initialized with backend credentials");

      // Health check
      const healthy = await client.health();
      if (!healthy) {
        logger.warn(
          "Moss indexer initialization warning. Ensure indexes exist before querying."
        );
      } else {
        logger.info("Moss client initialized successfully.");
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

      // Note: Cache removed - indexing is local and caching not needed
      const router = new QueryRouter(client, null, metrics, repoName);
      const mcpServer = createMcpServer(router, config);
      const transport = await startHttpTransport(mcpServer);

      logger.info(`MCP server listening at ${transport.url}`);
    });
}
