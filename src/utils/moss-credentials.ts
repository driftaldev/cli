import { loadAuthTokens } from "./token-manager.js";

// Default backend URL - can be overridden via env var
const BACKEND_BASE_URL = process.env.SCOUT_AUTH_URL || "http://localhost:3000";

export interface MossCredentials {
  project_id: string;
  project_key: string;
}

/**
 * Fetch Moss credentials from the backend API
 * Requires authentication - will use stored tokens or throw if not authenticated
 */
export async function fetchMossCredentials(): Promise<MossCredentials> {
  // Load tokens
  const tokens = await loadAuthTokens();

  if (!tokens) {
    throw new Error(
      "Not authenticated. Please run 'scoutcli login' to authenticate."
    );
  }

  // Fetch credentials from backend
  const url = `${BACKEND_BASE_URL}/v1/moss/credentials`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });

    if (response.status === 401) {
      throw new Error(
        "Authentication failed. Please run 'scoutcli login' to re-authenticate."
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Failed to fetch Moss credentials (${response.status})`;

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = errorJson.error;
        }
      } catch {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const credentials = (await response.json()) as MossCredentials;

    if (!credentials.project_id || !credentials.project_key) {
      throw new Error("Invalid credentials response from backend");
    }

    return credentials;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unknown error while fetching Moss credentials");
  }
}

