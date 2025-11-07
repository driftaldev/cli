import { Command } from "commander";
import prompts from "prompts";
import { deleteAuthTokens, getAuthStatus } from "../utils/token-manager.js";
import { logger } from "../utils/logger.js";
import chalk from "chalk";

/**
 * Handle logout command
 */
async function handleLogout(options: { force?: boolean }) {
  try {
    // Check if authenticated
    const status = await getAuthStatus();

    if (!status.authenticated) {
      console.log(chalk.yellow("\nℹ️  You're not currently logged in.\n"));
      return;
    }

    // Confirm logout unless --force is used
    if (!options.force) {
      const response = await prompts({
        type: "confirm",
        name: "value",
        message: "Are you sure you want to log out?",
        initial: false
      });

      if (!response.value) {
        logger.info("Logout cancelled.");
        return;
      }
    }

    // Delete auth tokens
    await deleteAuthTokens();

    console.log(chalk.green("\n✅ Successfully logged out.\n"));
    console.log(chalk.gray(`To log back in, run: ${chalk.bold("scoutcli login")}\n`));

  } catch (error) {
    logger.error("Logout error:", error);
    process.exit(1);
  }
}

/**
 * Register logout command
 */
export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Log out and remove authentication tokens")
    .option("-f, --force", "Skip confirmation prompt")
    .action(handleLogout);
}
