import fs from "fs/promises";
import path from "path";
import { Command } from "commander";
import chokidar from "chokidar";
import ora from "ora";

import { loadConfig, type ScoutConfig } from "../config/loader.js";
import { DEFAULT_FILE_EXTENSIONS, DEFAULT_EXCLUDE_PATTERNS } from "../config/constants.js";
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

  // If repo name exists, use it
  if (currentRepoName) {
    logger.info(`Using repo name "${currentRepoName}" for ${repoRoot}.`);
    return currentRepoName;
  }

  // Auto-generate repo name from directory name
  const dirName = path.basename(path.resolve(repoRoot));
  const repoName = dirName || "default";
  await saveRepoName(repoRoot, repoName);
  logger.info(`Using repo name: ${repoName}`);
  return repoName;
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
  // Get or auto-generate repo name based on directory
  let repoName = await loadSavedRepoName(repoPath);

  if (!repoName) {
    // Always use directory name as default (non-interactive)
    const dirName = path.basename(path.resolve(repoPath));
    repoName = dirName || "default";
    await saveRepoName(repoPath, repoName);
    logger.info(`Using repo name: ${repoName}`);
  }

  // Check if already indexed
  const isIndexed = await client.isIndexed(repoName);

  if (!isIndexed) {
    logger.info(`Index not found for ${repoName}. Auto-indexing...`);
    await performIndex(
      repoName,
      repoPath,
      DEFAULT_FILE_EXTENSIONS,
      DEFAULT_EXCLUDE_PATTERNS,
      client
    );
  } else {
    logger.debug(`Index already exists for ${repoName}`);
  }

  // Always start watcher in background (non-blocking)
  setupWatcher({
    repoName,
    root: repoPath,
    extensions: DEFAULT_FILE_EXTENSIONS,
    excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
    client
  });

  return repoName;
}

export function registerIndexCommand(program: Command): void {
  program
    .command("index")
    .description("Index current repository")
    .option("--full", "Perform a full re-index", false)
    .option("--watch", "Watch for file changes", false)
    .action(async (options) => {
      const config = await loadConfig();
      const repoRoot = process.env.INIT_CWD ?? process.cwd();

      // Initialize Moss client using credentials from config
      const client = new MossClient(
        config.moss.project_id,
        config.moss.project_key,
        config.moss.index_directory
      );

      // Get or prompt for repo name
      const repoName = await promptRepoName(repoRoot);

      // Perform indexing
      await performIndex(
        repoName,
        repoRoot,
        DEFAULT_FILE_EXTENSIONS,
        DEFAULT_EXCLUDE_PATTERNS,
        client
      );

      // Setup watcher if requested
      if (options.watch) {
        setupWatcher({
          repoName,
          root: repoRoot,
          extensions: DEFAULT_FILE_EXTENSIONS,
          excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
          client
        });
      }
    });
}
