import chalk from "chalk";
import { getCurrentModel, getVersion, getCurrentDirectory } from "./banner-utils.js";

/**
 * Format model name for display (e.g., "claude-sonnet-4.5" -> "Sonnet 4.5")
 */
function formatModelName(model: string): string {
  const patterns = [
    { regex: /claude-sonnet-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Sonnet ${m[1]}` },
    { regex: /claude-opus-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Opus ${m[1]}` },
    { regex: /claude-haiku-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Haiku ${m[1]}` },
    { regex: /sonnet-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Sonnet ${m[1]}` },
    { regex: /opus-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Opus ${m[1]}` },
    { regex: /haiku-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Haiku ${m[1]}` },
  ];

  for (const pattern of patterns) {
    const match = model.match(pattern.regex);
    if (match) {
      return pattern.format(match);
    }
  }

  return model.charAt(0).toUpperCase() + model.slice(1);
}

/**
 * Display the Driftal banner at the top of the terminal
 * This should be called at the start of interactive commands
 */
export async function showConsoleBanner(): Promise<void> {
  const model = await getCurrentModel();
  const version = getVersion();
  const directory = getCurrentDirectory();

  const displayModel = model ? formatModelName(model) : "No model selected";

  // ASCII art logo
  const logo = [
    chalk.cyan("▄▄▄"),
    chalk.cyan("█ █"),
    chalk.cyan("▀▀▀")
  ];

  // Print banner
  console.log();
  console.log(
    logo[0] + "  " + chalk.white.bold("Driftal") + chalk.gray(` v${version}`)
  );
  console.log(
    logo[1] + "  " + chalk.gray(displayModel)
  );
  console.log(
    logo[2] + "  " + chalk.gray(directory)
  );
  console.log();
}
