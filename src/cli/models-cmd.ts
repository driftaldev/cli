import { Command } from "commander";
import prompts from "prompts";
import {
  getAuthStatus,
  updateModelPreferences,
} from "../utils/token-manager.js";
import { logger } from "../utils/logger.js";
import chalk from "chalk";
import { showConsoleBanner } from "../ui/components/console-banner.js";
import { fetchSupportedModels } from "../utils/models.js";

/**
 * List currently selected models
 */
async function handleModelsList() {
  await showConsoleBanner();

  try {
    const status = await getAuthStatus();

    if (!status.authenticated) {
      console.log(
        chalk.yellow("\n⚠️  Not authenticated. Run 'driftal login' first.\n")
      );
      return;
    }

    // Fetch models from backend
    const models = await fetchSupportedModels();
    const modelsMap = new Map(models.map((m) => [m.id, m]));

    const primary = status.tokens?.selectedModels?.primary;
    const fallback = status.tokens?.selectedModels?.fallback;

    console.log(chalk.cyan("\nCurrent Model Configuration\n"));

    if (primary) {
      const primaryInfo = modelsMap.get(primary);
      console.log(`Primary: ${chalk.bold(primaryInfo?.name || primary)}`);
      if (primaryInfo?.description) {
        console.log(chalk.gray(`  ${primaryInfo.description}`));
      }
    } else {
      console.log(chalk.yellow("Primary: Not set"));
    }

    console.log();

    if (fallback) {
      const fallbackInfo = modelsMap.get(fallback);
      console.log(`Fallback: ${chalk.bold(fallbackInfo?.name || fallback)}`);
      if (fallbackInfo?.description) {
        console.log(chalk.gray(`  ${fallbackInfo.description}`));
      }
    } else {
      console.log("Fallback: None");
    }

    console.log(
      chalk.gray(
        `\nTo change models, run: ${chalk.bold("driftal models select")}\n`
      )
    );
  } catch (error) {
    logger.error("Error listing models:", error);
    process.exit(1);
  }
}

/**
 * Update model selection
 */
async function handleModelsSelect() {
  await showConsoleBanner();

  try {
    const status = await getAuthStatus();

    if (!status.authenticated) {
      console.log(
        chalk.yellow("\n⚠️  Not authenticated. Run 'driftal login' first.\n")
      );
      return;
    }

    // Fetch models from backend
    const models = await fetchSupportedModels();
    const modelsMap = new Map(models.map((m) => [m.id, m]));

    const currentPrimary = status.tokens?.selectedModels?.primary;
    const currentFallback = status.tokens?.selectedModels?.fallback;

    const choices = models.map((model) => ({
      title: `${model.name} - ${model.description}`,
      value: model.id,
    }));

    console.log(chalk.cyan("\nUpdate Model Selection\n"));

    // Select primary model
    const initialPrimary = currentPrimary
      ? choices.findIndex((c) => c.value === currentPrimary)
      : 0;

    const primaryResponse = await prompts({
      type: "select",
      name: "primary",
      message: "Select your primary model:",
      choices,
      initial: initialPrimary,
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
      initial: !!currentFallback,
    });

    let fallback: string | undefined;

    if (wantsFallback.value) {
      const fallbackChoices = choices.filter(
        (c) => c.value !== primaryResponse.primary
      );
      const initialFallback = currentFallback
        ? fallbackChoices.findIndex((c) => c.value === currentFallback)
        : 0;

      const fallbackResponse = await prompts({
        type: "select",
        name: "fallback",
        message: "Select your fallback model:",
        choices: fallbackChoices,
        initial: initialFallback,
      });

      fallback = fallbackResponse.fallback;
    }

    // Save the selection
    await updateModelPreferences(primaryResponse.primary, fallback);

    const primaryInfo = modelsMap.get(primaryResponse.primary);

    console.log(chalk.green("\n✅ Model preferences updated!\n"));
    console.log(
      `Primary: ${chalk.bold(primaryInfo?.name || primaryResponse.primary)}`
    );

    if (fallback) {
      const fallbackInfo = modelsMap.get(fallback);
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
  await showConsoleBanner();

  try {
    const status = await getAuthStatus();

    if (!status.authenticated) {
      console.log(
        chalk.yellow("\n⚠️  Not authenticated. Run 'driftal login' first.\n")
      );
      return;
    }

    // Fetch models from backend
    const models = await fetchSupportedModels();


    const geminiModels = models.filter((model) => model.provider === "gemini");
    console.log(chalk.cyan("\nAvailable Models\n"));

    const anthropicModels = models.filter(
      (model) => model.provider === "anthropic"
    );

    const openaiModels = models.filter((model) => model.provider === "openai");

    if (anthropicModels.length > 0) {
      console.log(chalk.bold("Anthropic Models:"));
      for (const model of anthropicModels) {
        console.log(`  ${chalk.green("•")} ${chalk.bold(model.name)}`);
        console.log(`    ${chalk.gray(model.description)}`);
        console.log(chalk.gray(`    ID: ${model.id}`));
        console.log();
      }
    }

    if (openaiModels.length > 0) {
      console.log(chalk.bold("OpenAI Models:"));
      for (const model of openaiModels) {
        console.log(`  ${chalk.green("•")} ${chalk.bold(model.name)}`);
        console.log(`    ${chalk.gray(model.description)}`);
        console.log(chalk.gray(`    ID: ${model.id}`));
        console.log();
      }
    }

    if (geminiModels.length > 0) {
      console.log(chalk.bold("Gemini Models:"));
      for (const model of geminiModels) {
        console.log(`  ${chalk.green("•")} ${chalk.bold(model.name)}`);
        console.log(`    ${chalk.gray(model.description)}`);
        console.log(chalk.gray(`    ID: ${model.id}`));
        console.log();
      }
    }

    const openrouterModels = models.filter((model) => model.provider === "openrouter");
    if (openrouterModels.length > 0) {
      console.log(chalk.bold("OpenRouter Models:"));
      for (const model of openrouterModels) {
        console.log(`  ${chalk.green("•")} ${chalk.bold(model.name)}`);
        console.log(`    ${chalk.gray(model.description)}`);
        console.log(chalk.gray(`    ID: ${model.id}`));
        console.log();
      }
    }
  } catch (error) {
    logger.error("Error fetching available models:", error);
    process.exit(1);
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
