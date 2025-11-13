import { Command } from "commander";
import { initiateLogin } from "../utils/auth.js";
import { getAuthStatus } from "../utils/token-manager.js";
import { logger } from "../utils/logger.js";
import chalk from "chalk";
import { showConsoleBanner } from "../ui/components/console-banner.js";

/**
 * Handle login command
 */
async function handleLogin(options: { reauth?: boolean }) {
  await showConsoleBanner();

  try {
    // Check if already authenticated
    if (!options.reauth) {
      const status = await getAuthStatus();

      if (status.authenticated) {
        console.log(chalk.green("\n✅ Already authenticated!\n"));
        console.log(
          chalk.gray(
            `To re-authenticate, run: ${chalk.bold("driftal login --reauth")}\n`
          )
        );
        return;
      }
    }

    console.log(chalk.cyan("\n🔐 Initiating authentication...\n"));

    // Start OAuth flow (no model selection)
    const result = await initiateLogin();

    if (result.success && result.tokens) {
      console.log(chalk.green("\n✅ Authentication successful!\n"));
      console.log(
        `Email: ${chalk.bold(result.tokens.userEmail || "not provided")}`
      );
      console.log(
        chalk.gray(
          `\nYou're all set! Run ${chalk.bold(
            "driftal review"
          )} to start reviewing code.\n`
        )
      );
      console.log(
        chalk.gray(
          `To configure models, run: ${chalk.bold("driftal models select")}\n`
        )
      );
    } else {
      logger.error(
        `\n❌ Authentication failed: ${result.error || "Unknown error"}\n`
      );
      process.exit(1);
    }
  } catch (error) {
    logger.error("Login error:", error);
    process.exit(1);
  }
}

/**
 * Register login command
 */
export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Authenticate with Scout to use AI-powered code reviews")
    .option("--reauth", "Force re-authentication even if already logged in")
    .action(handleLogin);
}
