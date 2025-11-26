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

    const preferred = status.tokens?.preferredModel;

    console.log(chalk.cyan("\nCurrent Model Configuration\n"));

    if (preferred) {
      const preferredInfo = modelsMap.get(preferred);
      console.log(
        `Preferred Model: ${chalk.bold(preferredInfo?.name || preferred)}`
      );
      if (preferredInfo?.description) {
        console.log(chalk.gray(`  ${preferredInfo.description}`));
      }
    } else {
      console.log(chalk.yellow("Preferred Model: Not set"));
    }

    console.log(
      chalk.gray(
        `\nTo change your preferred model, run: ${chalk.bold("driftal models select")}\n`
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

    const currentPreferred = status.tokens?.preferredModel;

    if (models.length === 0) {
      console.log(chalk.yellow("No models available."));
      return;
    }

    const choices = models.map((model) => ({
      title: `${model.name} - ${model.description}`,
      value: model.id,
    }));

    console.log(chalk.cyan("\nSelect Preferred Model\n"));

    // Find current preferred model in choices
    const foundPreferredIndex = currentPreferred
      ? choices.findIndex((c) => c.value === currentPreferred)
      : -1;
    const initialPreferred = foundPreferredIndex >= 0 ? foundPreferredIndex : 0;

    const modelResponse = await prompts({
      type: "select",
      name: "preferred",
      message: "Select your preferred model:",
      choices,
      initial: initialPreferred,
    });

    if (!modelResponse.preferred) {
      logger.warn("Selection cancelled.");
      return;
    }

    // Save the selection
    await updateModelPreferences(modelResponse.preferred);

    const preferredInfo = modelsMap.get(modelResponse.preferred);

    console.log(chalk.green("\n✅ Model preference updated!\n"));
    console.log(
      `Preferred Model: ${chalk.bold(preferredInfo?.name || modelResponse.preferred)}`
    );

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

    const openrouterModels = models.filter(
      (model) => model.provider === "openrouter"
    );
    if (openrouterModels.length > 0) {
      console.log(chalk.bold("Anthropic Models:"));
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
