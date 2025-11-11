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
 * For now, this returns a hardcoded value as requested
 * @returns Version string
 */
export function getVersion(): string {
  return "0.0.1";
}

/**
 * Get the current working directory
 * @returns Absolute path to current directory
 */
export function getCurrentDirectory(): string {
  return process.cwd();
}
