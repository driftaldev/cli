import { Command } from "commander";
import { getAuthStatus } from "../utils/token-manager.js";
import chalk from "chalk";
import { showConsoleBanner } from "../ui/components/console-banner.js";

/**
 * Handle whoami/status command - shows detailed auth information
 */
async function handleWhoami() {
  await showConsoleBanner();

  try {
    const status = await getAuthStatus();

    if (!status.authenticated) {
      console.log(chalk.yellow("\nNot authenticated.\n"));
      console.log(
        chalk.gray(`Run ${chalk.bold("driftal login")} to authenticate.\n`)
      );
      return;
    }

    console.log(chalk.cyan("\nAuthentication Status\n"));

    // User info
    if (status.tokens?.userEmail) {
      console.log(`Email: ${chalk.bold(status.tokens.userEmail)}`);
    }

    // Token expiration info
    if (status.tokens?.expiresAt) {
      const expiresAt = new Date(status.tokens.expiresAt);
      const now = new Date();
      const timeUntilExpiry = status.tokens.expiresAt - now.getTime();
      const hoursUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
      const minutesUntilExpiry = Math.floor(
        (timeUntilExpiry % (1000 * 60 * 60)) / (1000 * 60)
      );

      if (status.expired) {
        console.log(
          `Token Status: ${chalk.red("Expired")} (expired at ${expiresAt.toLocaleString()})`
        );
      } else if (hoursUntilExpiry < 1) {
        console.log(
          `Token Status: ${chalk.yellow("Expiring soon")} (in ${minutesUntilExpiry} minutes)`
        );
      } else {
        console.log(
          `Token Status: ${chalk.green("Active")} (expires in ${hoursUntilExpiry}h ${minutesUntilExpiry}m)`
        );
      }
      console.log(chalk.gray(`  Expires at: ${expiresAt.toLocaleString()}`));
    } else {
      console.log(`Token Status: ${chalk.green("Active")} (no expiration)`);
    }

    // Refresh token availability
    if (status.tokens?.refreshToken) {
      console.log(`Refresh Token: ${chalk.green("Available")}`);
    } else {
      console.log(`Refresh Token: ${chalk.yellow("Not available")}`);
      console.log(
        chalk.gray("  Note: You may need to re-authenticate when token expires")
      );
    }

    // Model configuration
    if (status.tokens?.selectedModels) {
      console.log(
        `\nPrimary Model: ${chalk.bold(status.tokens.selectedModels.primary || "Not set")}`
      );
      if (status.tokens.selectedModels.fallback) {
        console.log(
          `Fallback Model: ${chalk.bold(status.tokens.selectedModels.fallback)}`
        );
      }
    }

    // Token age
    if (status.tokens?.createdAt) {
      const createdAt = new Date(status.tokens.createdAt);
      const age = Date.now() - status.tokens.createdAt;
      const daysOld = Math.floor(age / (1000 * 60 * 60 * 24));
      console.log(
        chalk.gray(
          `\nAuthenticated ${daysOld} day${daysOld !== 1 ? "s" : ""} ago (${createdAt.toLocaleDateString()})`
        )
      );
    }

    // Actions
    console.log(chalk.gray("\nActions:"));
    console.log(
      chalk.gray(
        `  • To re-authenticate: ${chalk.bold("driftal login --reauth")}`
      )
    );
    console.log(
      chalk.gray(`  • To change models: ${chalk.bold("driftal models select")}`)
    );
    console.log(chalk.gray(`  • To logout: ${chalk.bold("driftal logout")}\n`));
  } catch (error) {
    console.error(chalk.red("\n❌ Error checking authentication status\n"));
    console.error(error);
    process.exit(1);
  }
}

/**
 * Register whoami command
 */
export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show current authentication status and user information")
    .action(handleWhoami);

  // Also register as 'status' alias
  program
    .command("status")
    .description("Show current authentication status (alias for whoami)")
    .action(handleWhoami);
}
