import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  selectedModels?: {
    primary: string;
    fallback?: string;
  };
  userEmail?: string;
  createdAt: number;
  updatedAt: number;
}

const AUTH_FILE_NAME = ".scout/auth.json";

/**
 * Get the path to the global auth file in user's home directory
 */
function getAuthFilePath(): string {
  return path.join(os.homedir(), AUTH_FILE_NAME);
}

/**
 * Ensure the .scout directory exists in user's home
 */
async function ensureAuthDirectory(): Promise<void> {
  const authDir = path.dirname(getAuthFilePath());
  try {
    await fs.mkdir(authDir, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

/**
 * Load authentication tokens from ~/.scout/auth.json
 */
export async function loadAuthTokens(): Promise<AuthTokens | null> {
  try {
    const authPath = getAuthFilePath();
    const content = await fs.readFile(authPath, "utf-8");
    const data = JSON.parse(content) as AuthTokens;

    // Validate required fields
    if (!data.accessToken || !data.createdAt) {
      return null;
    }

    return data;
  } catch (error) {
    // File doesn't exist or is invalid
    return null;
  }
}

/**
 * Save authentication tokens to ~/.scout/auth.json
 */
export async function saveAuthTokens(tokens: AuthTokens): Promise<void> {
  await ensureAuthDirectory();

  const authPath = getAuthFilePath();
  const data = {
    ...tokens,
    updatedAt: Date.now()
  };

  await fs.writeFile(authPath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Update model preferences without changing tokens
 */
export async function updateModelPreferences(primary: string, fallback?: string): Promise<void> {
  const tokens = await loadAuthTokens();
  if (!tokens) {
    throw new Error("No authentication found. Run 'scoutcli login' first.");
  }

  tokens.selectedModels = { primary, fallback };
  tokens.updatedAt = Date.now();

  await saveAuthTokens(tokens);
}

/**
 * Check if the access token is expired
 */
export function isTokenExpired(tokens: AuthTokens): boolean {
  if (!tokens.expiresAt) {
    return false; // No expiration set
  }

  // Consider expired if within 5 minutes of expiration
  const bufferMs = 5 * 60 * 1000;
  return Date.now() >= (tokens.expiresAt - bufferMs);
}

/**
 * Delete authentication tokens (logout)
 */
export async function deleteAuthTokens(): Promise<void> {
  try {
    const authPath = getAuthFilePath();
    await fs.unlink(authPath);
  } catch (error) {
    // File doesn't exist, already logged out
  }
}

/**
 * Get the current authentication status
 */
export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  expired: boolean;
  tokens?: AuthTokens;
}> {
  const tokens = await loadAuthTokens();

  if (!tokens) {
    return { authenticated: false, expired: false };
  }

  const expired = isTokenExpired(tokens);

  return {
    authenticated: true,
    expired,
    tokens
  };
}
