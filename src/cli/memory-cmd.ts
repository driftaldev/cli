import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { ReviewMemory } from "../mastra/memory/review-memory.js";

/**
 * Create memory management commands
 */
export function createMemoryCommand(): Command {
  const memory = new Command("memory")
    .description("Manage review memory and learned patterns");

  // Stats command
  memory
    .command("stats")
    .description("Show memory statistics and learning progress")
    .action(async () => {
      try {
        const reviewMemory = new ReviewMemory();
        await reviewMemory.initialize();

        const stats = await reviewMemory.getStats();

        console.log(chalk.bold('\n📊 Review Memory Statistics\n'));

        const table = new Table({
          head: [chalk.cyan('Metric'), chalk.cyan('Value')],
          colWidths: [30, 20]
        });

        table.push(
          ['Total Reviews Stored', stats.totalReviews.toString()],
          ['Reviews with Feedback', stats.withFeedback.toString()],
          ['Acceptance Rate', `${(stats.acceptanceRate * 100).toFixed(1)}%`]
        );

        console.log(table.toString());

        if (stats.topIssueTypes.length > 0) {
          console.log(chalk.bold('\n🔝 Top Issue Types\n'));

          const issueTable = new Table({
            head: [chalk.cyan('Type'), chalk.cyan('Count')],
            colWidths: [30, 15]
          });

          for (const { type, count } of stats.topIssueTypes) {
            issueTable.push([type, count.toString()]);
          }

          console.log(issueTable.toString());
        }

        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
      }
    });

  // Patterns command
  memory
    .command("patterns")
    .description("Show learned patterns and confidence levels")
    .option("--repo <path>", "Filter patterns by repository path")
    .action(async (options) => {
      try {
        const reviewMemory = new ReviewMemory();
        await reviewMemory.initialize();

        const patterns = await reviewMemory.getLearnedPatterns(options.repo);

        if (patterns.length === 0) {
          console.log(chalk.yellow('\nNo learned patterns found.'));
          console.log(chalk.gray('Patterns are learned from user feedback on review issues.\n'));
          return;
        }

        console.log(chalk.bold('\n🧠 Learned Patterns\n'));

        const table = new Table({
          head: [
            chalk.cyan('Pattern'),
            chalk.cyan('Confidence'),
            chalk.cyan('Occurrences'),
            chalk.cyan('Acceptance'),
            chalk.cyan('Last Seen')
          ],
          colWidths: [25, 12, 13, 13, 20]
        });

        for (const pattern of patterns) {
          const lastSeen = new Date(pattern.lastSeen).toLocaleDateString();
          table.push([
            pattern.pattern,
            `${(pattern.confidence * 100).toFixed(1)}%`,
            pattern.occurrences.toString(),
            `${(pattern.acceptanceRate * 100).toFixed(1)}%`,
            lastSeen
          ]);
        }

        console.log(table.toString());
        console.log();
      } catch (error: any) {
        console.error(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
      }
    });

  // Clear command
  memory
    .command("clear")
    .description("Clear all review memory and learned patterns")
    .option("--confirm", "Skip confirmation prompt")
    .action(async (options) => {
      try {
        if (!options.confirm) {
          console.log(chalk.yellow('\n⚠️  This will delete all stored reviews and learned patterns.'));
          console.log(chalk.gray('Run with --confirm to proceed.\n'));
          return;
        }

        const reviewMemory = new ReviewMemory();
        await reviewMemory.initialize();
        await reviewMemory.clear();

        console.log(chalk.green('\n✓ Review memory cleared successfully\n'));
      } catch (error: any) {
        console.error(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
      }
    });

  // Export command
  memory
    .command("export")
    .description("Export review memory to JSON file")
    .argument("<output>", "Output file path")
    .action(async (output) => {
      try {
        const reviewMemory = new ReviewMemory();
        await reviewMemory.initialize();

        const stats = await reviewMemory.getStats();
        const patterns = await reviewMemory.getLearnedPatterns();

        const exportData = {
          exportDate: new Date().toISOString(),
          stats,
          patterns
        };

        const fs = await import('fs/promises');
        await fs.writeFile(output, JSON.stringify(exportData, null, 2));

        console.log(chalk.green(`\n✓ Memory exported to ${output}\n`));
      } catch (error: any) {
        console.error(chalk.red(`\nError: ${error.message}`));
        process.exit(1);
      }
    });

  return memory;
}
