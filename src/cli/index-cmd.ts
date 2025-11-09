import fs from "fs/promises";
import path from "path";
import { Command } from "commander";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chokidar from "chokidar";
import ora from "ora";

import { loadConfig, type ScoutConfig } from "../config/loader.js";
import { scanFiles } from "../core/indexer/file-scanner.js";
import {
  type FullIndexRequest,
  type IncrementalIndexRequest,
  MossClient
} from "../core/indexer/moss-client.js";
import { logger } from "../utils/logger.js";
import { detectStacks } from "../core/indexer/stack-detector.js";
import { getIgnorePatternsForStacks } from "../core/indexer/ignore-patterns.js";
import {
  loadSavedRepoName,
  RepoNameNotConfiguredError,
  saveRepoName
} from "../utils/repo-name-store.js";

interface WatchContext {
  repoName: string;
  root: string;
  extensions: string[];
  excludePatterns: string[];
  client: MossClient;
}

async function promptRepoName(repoRoot: string): Promise<string> {
  const currentRepoName = await loadSavedRepoName(repoRoot);

  // If repo name doesn't exist and we're in non-interactive mode, throw error
  if (!currentRepoName && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new RepoNameNotConfiguredError(repoRoot);
  }

  // If repo name exists and we're in non-interactive mode, use it
  if (currentRepoName && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    logger.info(
      `No interactive terminal detected. Using repo name "${currentRepoName}" for ${repoRoot}.`
    );
    return currentRepoName;
  }

  // Interactive mode: prompt for repo name
  const rl = readline.createInterface({ input, output });
  try {
    const promptMessage = currentRepoName
      ? `What do you want to name this indexed repository? (current: ${currentRepoName}, press Enter to keep): `
      : `What do you want to name this indexed repository?: `;

    const answer = await rl.question(promptMessage);
    const trimmed = answer.trim();

    // If user provided a name, use it. If they left it blank and there's a current name, keep it.
    // If they left it blank and there's no current name, prompt again or throw error
    const finalName = trimmed || currentRepoName;

    if (!finalName) {
      throw new Error("Repository name cannot be empty");
    }

    await saveRepoName(repoRoot, finalName);
    return finalName;
  } finally {
    rl.close();
  }
}

async function buildFullIndexRequest(
  repoName: string,
  repoPath: string,
  extensions: string[],
  excludePatterns: string[]
): Promise<FullIndexRequest> {
  // Detect stacks in the project
  const stacks = await detectStacks(repoPath);
  const stackIgnorePatterns = getIgnorePatternsForStacks(stacks);

  logger.info(`Detected stacks: ${stacks.join(", ")}`);
  logger.info(`Applying ${stackIgnorePatterns.length} stack-specific ignore patterns`);

  const files = await scanFiles({
    root: repoPath,
    extensions,
    excludePatterns,
    base64Encode: false, // Moss uses plain text, not base64
    stacks,
    stackIgnorePatterns
  });

  return {
    repo_full_name: repoName,
    files
  };
}

async function performIndex(
  repoName: string,
  repoPath: string,
  extensions: string[],
  excludePatterns: string[],
  client: MossClient
) {
  const spinner = ora(`Indexing ${repoName}`).start();
  try {
    const request = await buildFullIndexRequest(
      repoName,
      repoPath,
      extensions,
      excludePatterns
    );
    const response = await client.fullIndex(request);
    spinner.succeed(`Indexed ${response.files_indexed} files for ${repoName}`);
  } catch (error) {
    spinner.fail(`Failed to index ${repoName}`);
    logger.error(String(error));
  }
}

function setupWatcher(context: WatchContext) {
  const { root, extensions, excludePatterns, repoName, client } = context;
  const watcher = chokidar.watch(root, {
    ignored: excludePatterns,
    ignoreInitial: true
  });

  watcher.on("all", async (event, filePath) => {
    console.log("Watcher detected", event, filePath);
    if (!["add", "change", "unlink"].includes(event)) return;
    const ext = path.extname(filePath);
    if (!extensions.includes(ext)) return;

    const relativePath = path.relative(root, filePath);
    logger.debug(`Watcher detected ${event} -> ${relativePath}`);

    try {
      const baseRequest: IncrementalIndexRequest = {
        repo_full_name: repoName
      };

      if (event === "unlink") {
        await client.incrementalIndex({
          ...baseRequest,
          deleted_files: [relativePath]
        });
        logger.info(`Removed ${relativePath} from index ${repoName}`);
        return;
      }

      const content = await fs.readFile(filePath, "utf8");
      const filePayload = {
        path: relativePath,
        content // Moss uses plain text, not base64
      };

      await client.incrementalIndex({
        ...baseRequest,
        files: [filePayload]
      });

      if (event === "add") {
        logger.info(`Added ${relativePath} to index ${repoName}`);
      } else {
        logger.info(`Updated ${relativePath} in index ${repoName}`);
      }
    } catch (error) {
      logger.error(
        `Incremental update failed for ${relativePath}: ${String(error)}`
      );
    }
  });

  logger.info(`Watching ${repoName} for changes...`);
}

/**
 * Ensures the repository is indexed and watching for changes.
 * This is called automatically by commands that need indexing.
 * Returns the repo name and starts a background watcher.
 */
export async function ensureIndexedAndWatching(
  repoPath: string,
  config: ScoutConfig,
  client: MossClient
): Promise<string> {
  // Get or prompt for repo name
  let repoName = await loadSavedRepoName(repoPath);
  
  if (!repoName) {
    // Non-interactive mode: use a default name based on directory
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const dirName = path.basename(path.resolve(repoPath));
      repoName = dirName || "default";
      await saveRepoName(repoPath, repoName);
      logger.info(`Using default repo name: ${repoName}`);
    } else {
      // Interactive mode: prompt user
      repoName = await promptRepoName(repoPath);
    }
  }

  // Check if already indexed
  const isIndexed = await client.isIndexed(repoName);
  
  if (!isIndexed) {
    logger.info(`Index not found for ${repoName}. Auto-indexing...`);
    await performIndex(
      repoName,
      repoPath,
      config.indexing.file_extensions,
      config.indexing.exclude_patterns,
      client
    );
  } else {
    logger.debug(`Index already exists for ${repoName}`);
  }

  // Always start watcher in background (non-blocking)
  setupWatcher({
    repoName,
    root: repoPath,
    extensions: config.indexing.file_extensions,
    excludePatterns: config.indexing.exclude_patterns,
    client
  });

  return repoName;
}

export function registerIndexCommand(program: Command): void {
  program
    .command("index")
    .description("Index configured repositories")
    .option("--full", "Perform a full re-index", false)
    .option("--watch", "Watch for file changes", false)
    .action(async (options) => {
      const config = await loadConfig();
      const commandRepoRoot = process.env.INIT_CWD ?? process.cwd();

      // Initialize Moss client - try backend first, fallback to config/env
      const indexDir = config.moss?.index_directory || ".scout-code/indexes";
      let client: MossClient;
      try {
        client = await MossClient.fromBackend(indexDir);
      } catch (error) {
        // Fallback to config/env if backend fetch fails
        const projectId = config.moss?.project_id;
        const projectKey = config.moss?.project_key;
        client = new MossClient(projectId, projectKey, indexDir);
      }

      const repoContexts: Array<{
        config: (typeof config.repos)[number];
        repoRoot: string;
        repoName: string;
      }> = [];

      for (const repo of config.repos) {
        const repoRoot = commandRepoRoot;
        const repoName = await promptRepoName(repoRoot);

        repoContexts.push({ config: repo, repoRoot, repoName });

        await performIndex(
          repoName,
          repoRoot,
          config.indexing.file_extensions,
          config.indexing.exclude_patterns,
          client
        );
      }

      if (options.watch) {
        for (const ctx of repoContexts.filter(({ config }) => config.watch)) {
          setupWatcher({
            repoName: ctx.repoName,
            root: ctx.repoRoot,
            extensions: config.indexing.file_extensions,
            excludePatterns: config.indexing.exclude_patterns,
            client
          });
        }
      }
    });
}
