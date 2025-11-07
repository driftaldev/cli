import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";

import { logger } from "../utils/logger.js";
import { loadApiKey, saveApiKey } from "../utils/repo-name-store.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Interactive setup for Scout Code")
    .action(async () => {
      const repoRoot = process.cwd();
      const existingKey = await loadApiKey(repoRoot);

      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        if (existingKey) {
          logger.info(
            "Non-interactive terminal detected. Keeping existing API key."
          );
          return;
        }

        logger.error(
          "Interactive terminal required to capture API key. Re-run `scout-code init` in an interactive shell."
        );
        process.exitCode = 1;
        return;
      }

      const rl = readline.createInterface({ input, output });
      try {
        const promptMessage = existingKey
          ? "Enter Scout API key (leave blank to keep existing): "
          : "Enter Scout API key: ";
        const answer = await rl.question(promptMessage);
        const trimmed = answer.trim();
        const nextKey = trimmed || existingKey;

        if (!nextKey) {
          logger.error("API key is required to complete setup.");
          process.exitCode = 1;
          return;
        }

        await saveApiKey(repoRoot, nextKey);
        logger.info("API key saved to .scout/config.json.");
      } finally {
        rl.close();
      }
    });
}
