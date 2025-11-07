import { Command } from "commander";
import prompts from "prompts";
import { initiateLogin } from "../utils/auth.js";
import { getAuthStatus } from "../utils/token-manager.js";
import { logger } from "../utils/logger.js";
import chalk from "chalk";

// Supported models with descriptions
const SUPPORTED_MODELS = {
  // Anthropic models
  "claude-3-5-sonnet-20241022": {
    provider: "anthropic",
    name: "Claude 3.5 Sonnet",
    description: "Best balance of intelligence and speed",
  },
  "claude-3-5-haiku-20241022": {
    provider: "anthropic",
    name: "Claude 3.5 Haiku",
    description: "Fast and cost-effective",
  },
  "claude-3-opus-20240229": {
    provider: "anthropic",
    name: "Claude 3 Opus",
    description: "Most capable, highest cost",
  },

  // OpenAI models
  "gpt-4-turbo": {
    provider: "openai",
    name: "GPT-4 Turbo",
    description: "Latest GPT-4 with vision support",
  },
  "gpt-4": {
    provider: "openai",
    name: "GPT-4",
    description: "Most capable GPT-4 model",
  },
  "gpt-3.5-turbo": {
    provider: "openai",
    name: "GPT-3.5 Turbo",
    description: "Fast and affordable",
  },
};

type ModelKey = keyof typeof SUPPORTED_MODELS;

/**
 * Prompt user to select models
 */
async function promptForModels(): Promise<{
  primary: string;
  fallback?: string;
} | null> {
  const choices = Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
    title: `${info.name} - ${info.description}`,
    value: id,
  }));

  console.log(chalk.cyan("\n🤖 Model Selection\n"));

  // Select primary model
  const primaryResponse = await prompts({
    type: "select",
    name: "primary",
    message: "Select your primary model for code reviews:",
    choices,
    initial: 0,
  });

  if (!primaryResponse.primary) {
    return null; // User cancelled
  }

  // Ask if they want a fallback
  const wantsFallback = await prompts({
    type: "confirm",
    name: "value",
    message: "Would you like to configure a fallback model?",
    initial: false,
  });

  let fallback: string | undefined;

  if (wantsFallback.value) {
    const fallbackChoices = choices.filter(
      (c) => c.value !== primaryResponse.primary
    );

    const fallbackResponse = await prompts({
      type: "select",
      name: "fallback",
      message: "Select your fallback model:",
      choices: fallbackChoices,
      initial: 0,
    });

    fallback = fallbackResponse.fallback;
  }

  return {
    primary: primaryResponse.primary,
    fallback,
  };
}

/**
 * Handle login command
 */
async function handleLogin(options: { reauth?: boolean }) {
  try {
    // Check if already authenticated
    if (!options.reauth) {
      const status = await getAuthStatus();

      if (status.authenticated && !status.expired) {
        const primaryModel =
          status.tokens?.selectedModels?.primary || "not set";
        const fallbackModel = status.tokens?.selectedModels?.fallback || "none";

        console.log(chalk.green("\n✅ Already authenticated!\n"));
        console.log(`Primary model: ${chalk.bold(primaryModel)}`);
        console.log(`Fallback model: ${chalk.bold(fallbackModel)}`);
        console.log(
          chalk.gray(
            `\nTo change models, run: ${chalk.bold("scoutcli models")}`
          )
        );
        console.log(
          chalk.gray(
            `To re-authenticate, run: ${chalk.bold(
              "scoutcli login --reauth"
            )}\n`
          )
        );
        return;
      }

      if (status.authenticated && status.expired) {
        logger.warn("Your authentication has expired. Please log in again.\n");
      }
    }

    // Prompt for model selection
    const models = await promptForModels();

    if (!models) {
      logger.warn("Login cancelled.");
      process.exit(0);
    }

    console.log(chalk.cyan("\n🔐 Initiating authentication...\n"));

    // Start OAuth flow
    const result = await initiateLogin(models);

    if (result.success && result.tokens) {
      const primaryModel =
        SUPPORTED_MODELS[result.tokens.selectedModels?.primary as ModelKey]
          ?.name ||
        result.tokens.selectedModels?.primary ||
        "unknown";

      console.log(chalk.green("\n✅ Authentication successful!\n"));
      console.log(
        `Email: ${chalk.bold(result.tokens.userEmail || "not provided")}`
      );
      console.log(`Primary model: ${chalk.bold(primaryModel)}`);

      if (result.tokens.selectedModels?.fallback) {
        const fallbackModel =
          SUPPORTED_MODELS[result.tokens.selectedModels.fallback as ModelKey]
            ?.name || result.tokens.selectedModels.fallback;
        console.log(`Fallback model: ${chalk.bold(fallbackModel)}`);
      }

      console.log(
        chalk.gray(
          `\nYou're all set! Run ${chalk.bold(
            "scoutcli review"
          )} to start reviewing code.\n`
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
