import { loadAuthTokens, isTokenExpired } from "./token-manager.js";
import { refreshAccessToken } from "./auth.js";
import { logger } from "./logger.js";

// Default backend URL - can be overridden via env var
const BACKEND_BASE_URL =
  process.env.SCOUT_AUTH_URL || "https://auth.driftal.dev";

export interface MorphCredentials {
  api_key: string;
}

/**
 * Fetch Morph credentials from the backend API
 * Requires authentication - will use stored tokens or throw if not authenticated
 * Automatically refreshes expired tokens
 */
export async function fetchMorphCredentials(): Promise<MorphCredentials> {
  // Load tokens
  let tokens = await loadAuthTokens();

  if (!tokens) {
    throw new Error(
      "Not authenticated. Please run 'driftal login' to authenticate."
    );
  }

  // Check if token is expired and refresh if needed
  if (isTokenExpired(tokens)) {
    if (tokens.refreshToken) {
      logger.debug(
        "Token expired, refreshing before fetching Morph credentials..."
      );
      const refreshResult = await refreshAccessToken(tokens.refreshToken);
      if (refreshResult.success && refreshResult.tokens) {
        tokens = refreshResult.tokens;
        logger.debug("Token refreshed successfully");
      } else {
        throw new Error(
          "Token expired and refresh failed. Please run 'driftal login' to re-authenticate."
        );
      }
    } else {
      throw new Error(
        "Token expired and no refresh token available. Please run 'driftal login' to re-authenticate."
      );
    }
  }

  // Fetch credentials from backend
  const url = `${BACKEND_BASE_URL}/v1/morph/credentials`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });

    if (response.status === 401) {
      // Token might have been invalidated server-side, try to refresh
      logger.debug("Received 401, attempting to refresh token...");

      // Reload tokens from disk first
      tokens = await loadAuthTokens();

      if (tokens?.refreshToken) {
        const refreshResult = await refreshAccessToken(tokens.refreshToken);
        if (refreshResult.success && refreshResult.tokens) {
          tokens = refreshResult.tokens;
          logger.debug("Token refreshed, retrying request...");

          // Retry the request with new token
          const retryResponse = await fetch(url, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          });

          if (retryResponse.status === 401) {
            throw new Error(
              "Authentication failed after token refresh. Please run 'driftal login' to re-authenticate."
            );
          }

          if (!retryResponse.ok) {
            const errorText = await retryResponse.text();
            let errorMessage = `Failed to fetch Morph credentials (${retryResponse.status})`;
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

          const credentials = (await retryResponse.json()) as MorphCredentials;
          if (!credentials.api_key) {
            throw new Error("Invalid credentials response from backend");
          }
          return credentials;
        }
      }

      throw new Error(
        "Authentication failed. Please run 'driftal login' to re-authenticate."
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Failed to fetch Morph credentials (${response.status})`;

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

    const credentials = (await response.json()) as MorphCredentials;

    if (!credentials.api_key) {
      throw new Error("Invalid credentials response from backend");
    }

    return credentials;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unknown error while fetching Morph credentials");
  }
}
