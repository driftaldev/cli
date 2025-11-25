import path from "path";
import { readFileSync } from "fs";
import { getAuthStatus } from "../../utils/token-manager.js";

/**
 * Get the current selected model from auth tokens
 * @returns The primary model name, or undefined if not authenticated or no model selected
 */
export async function getCurrentModel(): Promise<string | undefined> {
  try {
    const authStatus = await getAuthStatus();

    if (!authStatus.authenticated || !authStatus.tokens) {
      return undefined;
    }

    return authStatus.tokens.selectedModels?.primary;
  } catch (error) {
    // If there's any error reading auth tokens, return undefined
    return undefined;
  }
}

/**
 * Get the version from package.json
 * @returns Version string
 */
export function getVersion(): string {
  const packageJson = readFileSync(
    path.join(__dirname, "../../../package.json"),
    "utf8"
  );
  const packageData = JSON.parse(packageJson);
  return packageData.version;
}

/**
 * Get the current working directory
 * @returns Absolute path to current directory
 */
export function getCurrentDirectory(): string {
  return process.cwd();
}
