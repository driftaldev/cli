import { Command } from "commander";
import ora from "ora";
import chalk from "chalk";
import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import React from "react";
import {
  getUnstagedChanges,
  getStagedChanges,
  getDiff,
  getCommitDiff,
} from "../utils/git.js";
import { loadLLMConfig, loadConfig } from "../config/loader.js";
import { CodeReviewer } from "../core/review/reviewer.js";
import { TextFormatter } from "../core/review/formatters/text-formatter.js";
import { selectFiles } from "../utils/file-selector.js";
import type { LLMConfig, ReviewConfig } from "../config/schema.js";
import type { ReviewIssue } from "../core/review/issue.js";
import ReviewSummary from "../ui/review/ReviewSummary.js";
import { ensureIndexedAndWatching } from "./index-cmd.js";
import { MossClient } from "../core/indexer/moss-client.js";
import { MorphApplier } from "../core/review/morph-applier.js";
import { AppLayout } from "../ui/components/AppLayout.js";
import {
  getCurrentModel,
  getVersion,
  getCurrentDirectory,
} from "../ui/components/banner-utils.js";
import { showConsoleBanner } from "../ui/components/console-banner.js";
import { loadAuthTokens } from "../utils/token-manager.js";
import { logger } from "../utils/logger.js";
import type {
  ReviewResults,
  ReviewIssue as ReviewIssueType,
} from "../core/review/issue.js";

let inkModule: any | null = null;

async function getInk() {
  if (!inkModule) {
    process.env.DEV = "false";
    // @ts-ignore Ink ESM types are not resolved under current moduleResolution, runtime import is valid
    inkModule = await import("ink");
  }
  return inkModule;
}

/**
 * Log review results to backend for analytics
 */
async function logReviewToBackend(
  results: ReviewResults,
  userEmail: string
): Promise<void> {
  try {
    let tokens = await loadAuthTokens();
    if (!tokens) {
      logger.debug("Not authenticated, skipping review logging");
      return;
    }

    // Check if token is expired and refresh if needed
    const { isTokenExpired } = await import("../utils/token-manager.js");
    const { refreshAccessToken } = await import("../utils/auth.js");

    if (isTokenExpired(tokens)) {
      if (tokens.refreshToken) {
        logger.debug("Token expired, refreshing before logging review...");
        const refreshResult = await refreshAccessToken(tokens.refreshToken);
        if (refreshResult.success && refreshResult.tokens) {
          tokens = refreshResult.tokens;
          logger.debug("Token refreshed successfully");
        } else {
          logger.debug("Token refresh failed, skipping review logging");
          return;
        }
      } else {
        logger.debug(
          "Token expired and no refresh token, skipping review logging"
        );
        return;
      }
    }

    const CLOUD_PROXY_URL =
      process.env.SCOUT_PROXY_URL || "https://auth.driftal.dev";

    // Format issues for backend
    const formattedIssues = results.issues.map((issue) => ({
      title: issue.title,
      severity: issue.severity === "info" ? "low" : issue.severity, // Map 'info' to 'low' for backend
      file_path: issue.location.file,
      line_number: issue.location.line,
      description: issue.description || undefined,
      suggestion: issue.suggestion?.description || undefined,
    }));

    const requestBody = {
      email: userEmail,
      model: results.model || "claude-3-5-sonnet-20241022",
      total_tokens: results.totalTokens || 0,
      lines_of_code_reviewed: results.linesOfCodeReviewed || 0,
      review_duration_ms: results.duration || 0,
      repository_name: results.repositoryName,
      issues: formattedIssues,
    };

    logger.debug("Logging review to backend", {
      issueCount: formattedIssues.length,
      totalTokens: requestBody.total_tokens,
      repository: requestBody.repository_name,
    });

    const response = await fetch(`${CLOUD_PROXY_URL}/v1/reviews`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Failed to log review to backend", {
        status: response.status,
        error: errorText,
      });
      return;
    }

    const data = await response.json();
    logger.debug("Review logged successfully", {
      reviewId: data.review_id,
      issuesCreated: data.issues_created,
    });
  } catch (error) {
    // Don't fail the review if logging fails
    logger.warn("Error logging review to backend", { error });
  }
}

/**
 * Apply a fix to a file using Morph Fast Apply
 */
async function applyFix(
  issue: ReviewIssue,
  repoPath: string,
  morphApplier: MorphApplier
): Promise<boolean> {
  if (!issue.suggestion || typeof issue.suggestion === "string") {
    console.log(chalk.yellow("  No code fix available for this issue"));
    return false;
  }

  const suggestion = issue.suggestion;

  if (!suggestion.code) {
    console.log(chalk.yellow("  No code fix available for this issue"));
    return false;
  }

  try {
    // Apply the fix using Morph's Fast Apply
    // Construct absolute path and pass it directly
    // Check if path is already absolute to avoid duplication
    const absoluteFilePath = issue.location.file;

    const result = await morphApplier.applyFixToFile(
      absoluteFilePath,
      suggestion.code,
      suggestion.description || "Apply code fix"
    );

    if (!result.success) {
      throw new Error("Failed to apply fix");
    }

    console.log(chalk.green("  ✓ Fix applied successfully"));
    console.log(
      chalk.gray(
        `    +${result.linesAdded} -${result.linesRemoved} ~${result.linesModified} lines`
      )
    );
    return true;
  } catch (error) {
    console.error(
      chalk.red(
        `  ✗ Failed to apply fix: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      )
    );
    return false;
  }
}

/**
 * Interactively prompt user to accept/reject fixes
 */
async function interactiveFixReview(
  issues: ReviewIssue[],
  repoPath: string
): Promise<void> {
  const fixableIssues = issues.filter(
    (issue) =>
      issue.suggestion &&
      typeof issue.suggestion !== "string" &&
      issue.suggestion.code
  );

  if (fixableIssues.length === 0) {
    console.log(
      chalk.yellow("\nNo automatic fixes available for the found issues.")
    );
    return;
  }

  // Initialize Morph applier once for the entire review session
  let morphApplier: MorphApplier;
  try {
    morphApplier = await MorphApplier.fromBackend();
    console.log(chalk.gray("Morph credentials fetched successfully"));
  } catch (error) {
    console.error(
      chalk.red(
        "\n✗ Morph credentials not configured. Please ensure your account has Morph access."
      )
    );
    if (error instanceof Error) {
      console.error(chalk.gray(`  ${error.message}`));
    }
    return;
  }

  console.log(
    chalk.bold(
      `\n🔧 Found ${fixableIssues.length} issue(s) with suggested fixes\n`
    )
  );

  for (const issue of fixableIssues) {
    const suggestion = issue.suggestion;

    if (!suggestion || typeof suggestion === "string") {
      continue;
    }

    console.log(chalk.cyan(`\n${issue.location.file}:${issue.location.line}`));
    console.log(chalk.bold(`  ${issue.title}`));
    console.log(chalk.gray(`  ${issue.description}\n`));

    console.log(chalk.green(`  Suggested fix: ${suggestion.description}`));

    if (suggestion.code) {
      console.log(chalk.gray("\n  Proposed code:"));
      console.log(chalk.gray("  " + suggestion.code.split("\n").join("\n  ")));
    }

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Apply this fix", value: "apply" },
          { name: "Skip this fix", value: "skip" },
          { name: "Skip all remaining fixes", value: "skip-all" },
        ],
      },
    ]);

    if (action === "skip-all") {
      console.log(chalk.yellow("\nSkipping all remaining fixes."));
      break;
    }

    if (action === "apply") {
      await applyFix(issue, repoPath, morphApplier);
    } else {
      console.log(chalk.gray("  Skipped"));
    }
  }
}

/**
 * Create a diff-like structure from selected files
 */
async function createDiffFromFiles(
  repoPath: string,
  filePaths: string[]
): Promise<any> {
  const files = [];
  let totalAdditions = 0;

  for (const filePath of filePaths) {
    const fullPath = path.join(repoPath, filePath);

    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n");

      // Create a single chunk with all lines marked as context
      // This allows the reviewer to analyze the entire file
      const diffLines = lines.map((line, index) => ({
        type: "context" as const,
        content: line,
        oldLineNumber: index + 1,
        newLineNumber: index + 1,
      }));

      // Detect language from file extension
      const ext = filePath.split(".").pop()?.toLowerCase();
      const languageMap: Record<string, string> = {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        rb: "ruby",
        go: "go",
        rs: "rust",
        java: "java",
        cpp: "cpp",
        c: "c",
        cs: "csharp",
        php: "php",
        swift: "swift",
        kt: "kotlin",
      };

      files.push({
        path: filePath,
        status: "modified" as const,
        chunks: [
          {
            oldStart: 1,
            oldLines: lines.length,
            newStart: 1,
            newLines: lines.length,
            lines: diffLines,
            header: filePath,
          },
        ],
        language: languageMap[ext || ""] || "unknown",
      });

      totalAdditions += lines.length;
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Could not read file ${filePath}`));
    }
  }

  return {
    files,
    stats: {
      additions: totalAdditions,
      deletions: 0,
    },
    base: "working-tree",
    head: "selected-files",
  };
}

export function createReviewCommand(): Command {
  return new Command("review")
    .description(
      "Review code changes for bugs, security issues, and best practices"
    )
    .argument(
      "[files...]",
      "Specific files to review (use @ to open file selector, default: unstaged changes)"
    )
    .option("--staged", "Review only staged changes")
    .option("--commit <sha>", "Review a specific commit")
    .option(
      "--branch <base>",
      "Review changes from a branch (compares with current branch)"
    )
    .option(
      "--severity <level>",
      "Minimum severity to show (critical|high|medium|low|info)",
      "low"
    )
    .option(
      "--analyzers <types...>",
      "Analyzers to run (logic, security, performance)",
      ["logic", "security", "performance"]
    )
    .option("--quick", "Quick mode - faster but less thorough")
    .option("--verbose", "Verbose output")
    .option("--no-memory", "Disable learning from this review")
    .option("--similar", "Show similar past issues from memory")
    .option("--fix", "Interactively apply suggested fixes")
    .action(async (files: string[], options) => {
      // Show banner at the very start
      await showConsoleBanner();

      const spinner = ora("Initializing review...").start();

      try {
        // 1. Load configuration
        spinner.text = "Loading configuration...";

        const config = await loadConfig();

        let llmConfig: LLMConfig;
        try {
          llmConfig = await loadLLMConfig();
        } catch (error) {
          spinner.fail("Authentication required");
          console.log(
            chalk.yellow(
              "\n" +
                (error instanceof Error
                  ? error.message
                  : "LLM configuration not found")
            )
          );
          console.log(
            chalk.cyan("\nTo get started, run: " + chalk.bold("driftal login"))
          );
          process.exit(1);
        }

        // 2. Auto-index and start watcher (non-blocking)
        spinner.text = "Ensuring codebase is indexed...";
        const repoPath = process.cwd();

        // Initialize Moss client using credentials from config
        const mossClient = new MossClient(
          config.moss.project_id,
          config.moss.project_key,
          config.moss.index_directory
        );

        // This will index if needed and start watching in background
        const repoName = await ensureIndexedAndWatching(
          repoPath,
          config,
          mossClient
        );

        // spinner.succeed(`Codebase indexed and watching for changes`);

        // Ensure review config exists with defaults
        const reviewConfig: ReviewConfig = {
          severity: { minimum: "low" },
          analyzers: {
            logic: { enabled: true, strictness: 0.7 },
            security: { enabled: true, checks: ["all"] },
            performance: { enabled: true, thresholds: { complexity: 10 } },
            patterns: { enabled: true, customRules: [] },
          },
          autoFix: { enabled: false, safeOnly: true, require: "prompt" },
          include: ["**/*"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/*.test.*"],
          languages: {},
          memory: {
            enabled: options.memory !== false,
            learnFromFeedback: options.memory !== false,
            shareAcrossRepos: false,
          },
          cache: { enabled: true, ttl: 86400 },
          output: { format: "text", verbose: false, groupBy: "severity" },
          mastra: {
            memory: {
              enabled: options.memory !== false,
              storageDir: ".driftal/memory",
              vectorDb: "local",
            },
            workflows: {
              parallel: true,
              timeout: 300000,
            },
            agents: {
              temperature: {
                security: 0.2,
                performance: 0.3,
                logic: 0.3,
              },
              maxSteps: 3,
            },
          },
        };

        // 3. Handle file selection with @ prefix
        let selectedFiles: string[] | null = null;

        // Check if user wants to select files interactively
        if (
          files.length > 0 &&
          files.some((f) => f === "@" || f.startsWith("@"))
        ) {
          spinner.stop();
          selectedFiles = await selectFiles(
            repoPath,
            "Select files to review (search across all files)"
          );
          spinner.start("Analyzing changes...");
        } else if (files.length > 0) {
          selectedFiles = files;
        }

        // Start timing after file selection is complete
        const reviewStartTime = Date.now();

        // 4. Get changes to review
        spinner.text = "Analyzing changes...";
        let diff;

        if (options.commit) {
          diff = await getCommitDiff(repoPath, options.commit);
        } else if (options.branch) {
          diff = await getDiff(repoPath, options.branch);
        } else if (options.staged) {
          diff = await getStagedChanges(repoPath);
        } else if (selectedFiles && selectedFiles.length > 0) {
          // Read selected files and create a diff-like structure
          diff = await createDiffFromFiles(repoPath, selectedFiles);
        } else {
          diff = await getUnstagedChanges(repoPath);
        }

        if (!diff || diff.files.length === 0) {
          spinner.succeed("No changes to review");
          console.log(
            chalk.gray(
              "\nTip: Make some code changes or use --staged or --commit options"
            )
          );
          return;
        }

        console.log(
          chalk.gray(`\nReviewing ${diff.files.length} file(s)...\n`)
        );

        // 4. Initialize reviewer
        spinner.text = "Initializing AI reviewer...";
        const reviewer = new CodeReviewer(llmConfig, reviewConfig);

        // 5. Run review
        spinner.text = "Running analysis...";
        const results = await reviewer.review(
          diff,
          null,
          {
            severity: options.severity as any,
            analyzers: options.analyzers,
            quick: options.quick,
            verbose: options.verbose,
          },
          (current, total, fileName) => {
            const shortPath =
              fileName.length > 40 ? "..." + fileName.slice(-37) : fileName;
            spinner.text = `Analyzing file ${current}/${total}: ${shortPath}`;
          }
        );

        const reviewEndTime = Date.now();
        const reviewDuration = reviewEndTime - reviewStartTime;
        const durationSeconds = (reviewDuration / 1000).toFixed(2);

        spinner.succeed(
          `Review complete - found ${results.issues.length} issue(s) in ${durationSeconds}s`
        );

        // Log review to backend (async, non-blocking)
        const tokens = await loadAuthTokens();
        if (tokens && tokens.userEmail) {
          logReviewToBackend(results, tokens.userEmail).catch((err) => {
            logger.debug("Failed to log review to backend", { error: err });
          });
        }

        // 6. Show similar issues if requested
        if (options.similar) {
          const memory = reviewer.getMemory();
          if (memory && results.issues.length > 0) {
            console.log(chalk.bold("\n🔍 Similar Past Issues:\n"));

            for (const issue of results.issues.slice(0, 3)) {
              const similar = await memory.findSimilarIssues(
                issue.location.file,
                issue.type,
                2
              );
              if (similar.length > 0) {
                console.log(
                  chalk.cyan(
                    `  ${issue.location.file}:${issue.location.line} - ${issue.title}`
                  )
                );
                for (const sim of similar) {
                  const feedback = sim.userFeedback
                    ? `[${sim.userFeedback}]`
                    : "[no feedback]";
                  console.log(chalk.gray(`    Previously seen: ${feedback}`));
                }
                console.log();
              }
            }
          }
        }

        // 7. Display results
        const formatter = new TextFormatter();
        const shouldUseInk = process.stdout.isTTY;

        if (shouldUseInk) {
          const ink = await getInk();
          const currentModel = await getCurrentModel();
          const version = getVersion();
          const directory = getCurrentDirectory();

          const app = ink.render(
            React.createElement(AppLayout, {
              ink,
              version,
              model: currentModel,
              directory,
              children: React.createElement(ReviewSummary, {
                results,
                ink,
                durationSeconds,
              }),
            })
          );
          await app.waitUntilExit();
        }

        if (!shouldUseInk || options.verbose) {
          formatter.format(results);
        }

        // 8. Interactive fix mode
        if (options.fix && results.issues.length > 0) {
          await interactiveFixReview(results.issues, repoPath);
        }

        // Exit with error code if critical/high severity issues found
        const criticalCount = results.issues.filter(
          (i) => i.severity === "critical"
        ).length;
        const highCount = results.issues.filter(
          (i) => i.severity === "high"
        ).length;

        if (criticalCount > 0 || highCount > 0) {
          process.exit(1);
        }
      } catch (error: any) {
        spinner.fail("Review failed");
        console.error(chalk.red(`\nError: ${error.message}`));

        if (options.verbose && error.stack) {
          console.error(chalk.gray(error.stack));
        }

        process.exit(1);
      }
    });
}
