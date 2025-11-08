import { Command } from "commander";
import prompts from "prompts";
import { getAuthStatus, updateModelPreferences } from "../utils/token-manager.js";
import { logger } from "../utils/logger.js";
import chalk from "chalk";

// Supported models (same as login-cmd.ts)
const SUPPORTED_MODELS = {
  // Anthropic models
  "claude-3-5-sonnet-20241022": {
    provider: "anthropic",
    name: "Claude 3.5 Sonnet",
    description: "Best balance of intelligence and speed"
  },
  "claude-3-5-haiku-20241022": {
    provider: "anthropic",
    name: "Claude 3.5 Haiku",
    description: "Fast and cost-effective"
  },
  "claude-3-opus-20240229": {
    provider: "anthropic",
    name: "Claude 3 Opus",
    description: "Most capable, highest cost"
  },

  // OpenAI models
  "gpt-4-turbo": {
    provider: "openai",
    name: "GPT-4 Turbo",
    description: "Latest GPT-4 with vision support"
  },
  "gpt-4": {
    provider: "openai",
    name: "GPT-4",
    description: "Most capable GPT-4 model"
  },
  "gpt-3.5-turbo": {
    provider: "openai",
    name: "GPT-3.5 Turbo",
    description: "Fast and affordable"
  }
};

type ModelKey = keyof typeof SUPPORTED_MODELS;

/**
 * List currently selected models
 */
async function handleModelsList() {
  try {
    const status = await getAuthStatus();

    if (!status.authenticated) {
      console.log(chalk.yellow("\n⚠️  Not authenticated. Run 'scoutcli login' first.\n"));
      return;
    }

    const primary = status.tokens?.selectedModels?.primary;
    const fallback = status.tokens?.selectedModels?.fallback;

    console.log(chalk.cyan("\nCurrent Model Configuration\n"));

    if (primary) {
      const primaryInfo = SUPPORTED_MODELS[primary as ModelKey];
      console.log(`Primary: ${chalk.bold(primaryInfo?.name || primary)}`);
      if (primaryInfo?.description) {
        console.log(chalk.gray(`  ${primaryInfo.description}`));
      }
    } else {
      console.log(chalk.yellow("Primary: Not set"));
    }

    console.log();

    if (fallback) {
      const fallbackInfo = SUPPORTED_MODELS[fallback as ModelKey];
      console.log(`Fallback: ${chalk.bold(fallbackInfo?.name || fallback)}`);
      if (fallbackInfo?.description) {
        console.log(chalk.gray(`  ${fallbackInfo.description}`));
      }
    } else {
      console.log("Fallback: None");
    }

    console.log(chalk.gray(`\nTo change models, run: ${chalk.bold("scoutcli models select")}\n`));

  } catch (error) {
    logger.error("Error listing models:", error);
    process.exit(1);
  }
}

/**
 * Update model selection
 */
async function handleModelsSelect() {
  try {
    const status = await getAuthStatus();

    if (!status.authenticated) {
      console.log(chalk.yellow("\n⚠️  Not authenticated. Run 'scoutcli login' first.\n"));
      return;
    }

    const currentPrimary = status.tokens?.selectedModels?.primary;
    const currentFallback = status.tokens?.selectedModels?.fallback;

    const choices = Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
      title: `${info.name} - ${info.description}`,
      value: id
    }));

    console.log(chalk.cyan("\nUpdate Model Selection\n"));

    // Select primary model
    const initialPrimary = currentPrimary
      ? choices.findIndex(c => c.value === currentPrimary)
      : 0;

    const primaryResponse = await prompts({
      type: "select",
      name: "primary",
      message: "Select your primary model:",
      choices,
      initial: initialPrimary
    });

    if (!primaryResponse.primary) {
      logger.warn("Selection cancelled.");
      return;
    }

    // Ask about fallback
    const wantsFallback = await prompts({
      type: "confirm",
      name: "value",
      message: "Would you like to configure a fallback model?",
      initial: !!currentFallback
    });

    let fallback: string | undefined;

    if (wantsFallback.value) {
      const fallbackChoices = choices.filter(c => c.value !== primaryResponse.primary);
      const initialFallback = currentFallback
        ? fallbackChoices.findIndex(c => c.value === currentFallback)
        : 0;

      const fallbackResponse = await prompts({
        type: "select",
        name: "fallback",
        message: "Select your fallback model:",
        choices: fallbackChoices,
        initial: initialFallback
      });

      fallback = fallbackResponse.fallback;
    }

    // Save the selection
    await updateModelPreferences(primaryResponse.primary, fallback);

    const primaryInfo = SUPPORTED_MODELS[primaryResponse.primary as ModelKey];

    console.log(chalk.green("\n✅ Model preferences updated!\n"));
    console.log(`Primary: ${chalk.bold(primaryInfo?.name || primaryResponse.primary)}`);

    if (fallback) {
      const fallbackInfo = SUPPORTED_MODELS[fallback as ModelKey];
      console.log(`Fallback: ${chalk.bold(fallbackInfo?.name || fallback)}`);
    } else {
      console.log("Fallback: None");
    }

    console.log();

  } catch (error) {
    logger.error("Error updating models:", error);
    process.exit(1);
  }
}

/**
 * Show available models
 */
async function handleModelsAvailable() {
  console.log(chalk.cyan("\nAvailable Models\n"));

  const anthropicModels = Object.entries(SUPPORTED_MODELS)
    .filter(([_, info]) => info.provider === "anthropic");

  const openaiModels = Object.entries(SUPPORTED_MODELS)
    .filter(([_, info]) => info.provider === "openai");

  if (anthropicModels.length > 0) {
    console.log(chalk.bold("Anthropic Models:"));
    for (const [id, info] of anthropicModels) {
      console.log(`  ${chalk.green("•")} ${chalk.bold(info.name)}`);
      console.log(`    ${chalk.gray(info.description)}`);
      console.log(chalk.gray(`    ID: ${id}`));
      console.log();
    }
  }

  if (openaiModels.length > 0) {
    console.log(chalk.bold("OpenAI Models:"));
    for (const [id, info] of openaiModels) {
      console.log(`  ${chalk.green("•")} ${chalk.bold(info.name)}`);
      console.log(`    ${chalk.gray(info.description)}`);
      console.log(chalk.gray(`    ID: ${id}`));
      console.log();
    }
  }
}

/**
 * Register models command with subcommands
 */
export function registerModelsCommand(program: Command): void {
  const modelsCmd = program
    .command("models")
    .description("Manage your AI model preferences");

  modelsCmd
    .command("list")
    .description("Show currently selected models")
    .action(handleModelsList);

  modelsCmd
    .command("select")
    .description("Change your model preferences")
    .action(handleModelsSelect);

  modelsCmd
    .command("available")
    .description("List all available models")
    .action(handleModelsAvailable);

  // Default action (no subcommand) shows current selection
  modelsCmd.action(handleModelsList);
}
