import { Command } from "commander";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import ora from "ora";

import { loadConfig } from "../config/loader.js";
import { MossClient } from "../core/indexer/moss-client.js";
import { logger } from "../utils/logger.js";
import {
  loadSavedRepoName,
  RepoNameNotConfiguredError,
} from "../utils/repo-name-store.js";
import { ensureIndexedAndWatching } from "./index-cmd.js";

interface ChatOptions {
  maxResults?: number;
}

function formatSearchResults(results: any[], queryTime: number): string {
  if (results.length === 0) {
    return chalk.yellow("\n❌ No results found. Try rephrasing your query.\n");
  }

  let output =
    chalk.green(`\n⚡ ${queryTime}ms`) +
    chalk.gray(` | Found ${results.length} results\n\n`);

  for (const result of results) {
    const score = Math.round((result.score || 0) * 100);
    const scoreColor =
      score > 80 ? chalk.green : score > 60 ? chalk.yellow : chalk.gray;

    // File path with line numbers
    const location =
      result.line_start && result.line_end
        ? `${result.file_path}:${result.line_start}-${result.line_end}`
        : result.file_path || "unknown";

    output += chalk.blue("📄 ") + chalk.cyan(location);
    output += " " + scoreColor(`(${score}%)\n`);

    // Code snippet preview (show more lines - up to 10 or 300 chars)
    if (result.content || result.snippet) {
      const fullText = result.content || result.snippet;
      const lines = fullText.split("\n");

      // Show up to 10 lines or 300 characters, whichever comes first
      let previewLines: string[] = [];
      let charCount = 0;
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        if (charCount + lines[i].length > 300) break;
        previewLines.push(lines[i]);
        charCount += lines[i].length;
      }

      const snippet = previewLines.join("\n");
      const indentedSnippet = snippet
        .split("\n")
        .map((line) => "   " + chalk.gray(line.substring(0, 100))) // Truncate very long lines
        .join("\n");
      output += indentedSnippet;

      // Show if there's more content
      if (lines.length > previewLines.length) {
        output += chalk.dim(
          "\n   ... (" + (lines.length - previewLines.length) + " more lines)"
        );
      }
      output += "\n\n";
    }
  }

  return output;
}

function showWelcome(): void {
  console.log("\n" + chalk.bold.cyan("🔍 Scout Code Interactive Chat"));
  console.log(chalk.gray("Ask questions about your codebase"));
  console.log(chalk.gray("Commands: /help /clear /exit\n"));
}

function showHelp(): void {
  console.log("\n" + chalk.bold("Available Commands:"));
  console.log(chalk.cyan("  /help   ") + "Show this help message");
  console.log(chalk.cyan("  /clear  ") + "Clear the screen");
  console.log(chalk.cyan("  /exit   ") + "Exit chat mode");
  console.log(chalk.gray("\nOr just type your question naturally!\n"));
}

async function handleQuery(
  client: MossClient,
  query: string,
  repoName: string,
  maxResults: number
): Promise<void> {
  const spinner = ora({
    text: "Searching...",
    color: "cyan",
  }).start();

  try {
    const startTime = performance.now();
    const response = await client.search({
      query,
      repos: [repoName],
      max_results: maxResults,
    });
    const endTime = performance.now();
    const queryTime = Math.round(endTime - startTime);

    spinner.stop();
    console.log(formatSearchResults(response.results, queryTime));
  } catch (error) {
    spinner.stop();
    console.log(chalk.red("\n❌ Search failed: ") + (error as Error).message);
    console.log(chalk.gray("Stack trace:"), (error as Error).stack);
    console.log(); // Empty line before next prompt
  }
}

async function startChatSession(
  client: MossClient,
  repoName: string,
  options: ChatOptions
): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const maxResults = options.maxResults || 5;

  showWelcome();

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", () => {
    console.log(chalk.gray("\n\nGoodbye! 👋\n"));
    rl.close();
    process.exit(0);
  });

  try {
    while (true) {
      try {
        const query = await rl.question(chalk.bold("> "));
        const trimmedQuery = query.trim();

        if (!trimmedQuery) {
          continue;
        }

        // Handle commands
        if (trimmedQuery === "/exit" || trimmedQuery === "/quit") {
          console.log(chalk.gray("\nGoodbye! 👋\n"));
          break;
        }

        if (trimmedQuery === "/help") {
          showHelp();
          continue;
        }

        if (trimmedQuery === "/clear") {
          console.clear();
          showWelcome();
          continue;
        }

        // Handle search query
        await handleQuery(client, trimmedQuery, repoName, maxResults);
      } catch (queryError) {
        // Catch errors in individual queries but keep the loop running
        console.log(
          chalk.red("\n❌ Error: ") + (queryError as Error).message + "\n"
        );
      }
    }
  } finally {
    rl.close();
  }
}

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Interactive chat with your codebase")
    .option(
      "-n, --max-results <number>",
      "Maximum number of results to show",
      "5"
    )
    .action(async (options) => {
      try {
        const config = await loadConfig();
        const repoRoot = process.cwd();

        // Initialize Moss client - try backend first, fallback to config/env
        const indexDir = config.moss?.index_directory || ".scout-code/indexes";
        let client: MossClient;
        try {
          client = await MossClient.fromBackend(indexDir);
        } catch (error) {
          // Fallback to config/env if backend fetch fails
          const projectId = config.moss?.project_id;
          const projectKey = config.moss?.project_key;
          try {
            client = new MossClient(projectId, projectKey, indexDir);
          } catch (fallbackError) {
            logger.error((fallbackError as Error).message);
            process.exitCode = 1;
            return;
          }
        }

        // Auto-index and start watcher if needed
        const repoName = await ensureIndexedAndWatching(
          repoRoot,
          config,
          client
        );

        // Parse max results
        const maxResults = parseInt(options.maxResults, 10);
        if (isNaN(maxResults) || maxResults < 1) {
          logger.error("Invalid max-results value. Must be a positive number.");
          process.exitCode = 1;
          return;
        }

        // Start chat session
        await startChatSession(client, repoName, { maxResults });
      } catch (error) {
        logger.error(`Chat session failed: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}
