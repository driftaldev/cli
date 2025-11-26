import { spawn } from "child_process";
import * as http from "http";
import { AuthTokens, saveAuthTokens, loadAuthTokens } from "./token-manager.js";
import { logger } from "./logger.js";

// Default auth endpoint - can be overridden via env var
const AUTH_BASE_URL =
  process.env.DRIFTAL_AUTH_URL || "https://auth.driftal.dev";
const AUTH_CLI_URL = `${process.env.DRIFTAL_AUTH_URL || "https://auth.driftal.dev"}/cli/auth`;

function buildAuthApiUrl(path: string): string {
  return new URL(path, AUTH_BASE_URL).toString();
}

export interface AuthResult {
  success: boolean;
  tokens?: AuthTokens;
  error?: string;
}

/**
 * Generate a random state for OAuth flow security
 */
function generateState(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/**
 * Open URL in user's default browser
 */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

/**
 * Start local callback server to receive OAuth redirect
 */
async function startCallbackServer(state: string): Promise<{
  port: number;
  resultPromise: Promise<AuthResult>;
}> {
  let resolveResult!: (result: AuthResult) => void;
  let resolved = false;

  const settleResult = (result: AuthResult) => {
    if (resolved) {
      return;
    }
    resolved = true;
    resolveResult(result);
  };

  const resultPromise = new Promise<AuthResult>((resolve) => {
    resolveResult = resolve;
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "", `http://localhost`);

    if (url.pathname === "/callback") {
      const receivedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      // Handle error from auth server
      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Authentication Failed</h1>
                <p>${error}</p>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);

        server.close();
        settleResult({ success: false, error });
        return;
      }

      // Validate state to prevent CSRF
      if (receivedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Security Error</h1>
                <p>Invalid state parameter. Please try again.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);

        server.close();
        settleResult({
          success: false,
          error: "Invalid state parameter",
        });
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Missing Authorization Code</h1>
                <p>You can close this window and try again.</p>
              </body>
            </html>
          `);

        server.close();
        settleResult({
          success: false,
          error: "Missing authorization code",
        });
        return;
      }

      // Exchange code for tokens
      try {
        const tokenResponse = await fetch(buildAuthApiUrl("/auth/token"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (!tokenResponse.ok) {
          // Try to parse error response body for more details
          let errorMessage = `Token exchange failed: ${tokenResponse.statusText}`;
          try {
            const errorData = (await tokenResponse.json()) as {
              error?: string;
              message?: string;
            };
            if (errorData.error) {
              errorMessage = `Token exchange failed: ${errorData.error}`;
            } else if (errorData.message) {
              errorMessage = `Token exchange failed: ${errorData.message}`;
            }
          } catch {
            // If parsing fails, use the status text
          }
          throw new Error(errorMessage);
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          user_email?: string;
        };

        const tokens: AuthTokens = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          // Respect backend expiration if provided, otherwise tokens persist indefinitely
          expiresAt: tokenData.expires_in
            ? Date.now() + tokenData.expires_in * 1000
            : undefined,
          userEmail: tokenData.user_email,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          preferredModel: "gpt-5-codex",
        };

        // Log token details for debugging
        logger.debug("Tokens received:", {
          hasRefreshToken: !!tokenData.refresh_token,
          expiresIn: tokenData.expires_in,
          expiresAt: tokens.expiresAt,
        });

        // Success response
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>Authentication Successful!</h1>
                <p>You can now close this window and return to your terminal.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);
        server.close();
        settleResult({ success: true, tokens });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        logger.error("Token exchange error:", errorMessage);
        if (error instanceof Error && error.stack) {
          logger.debug("Token exchange error stack:", error.stack);
        }

        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Token Exchange Failed</h1>
                <p>${errorMessage}</p>
                <p>Please try again or contact support.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);

        server.close();
        settleResult({
          success: false,
          error: errorMessage,
        });
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.once("error", (error) => {
      rejectPort(error);
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        logger.debug(`Callback server listening on port ${address.port}`);
        resolvePort(address.port);
      } else {
        rejectPort(new Error("Failed to determine callback server port"));
      }
    });
  });

  server.on("error", (error) => {
    logger.error("Callback server encountered an error:", error);
    if (server.listening) {
      server.close();
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    settleResult({ success: false, error: message });
  });

  // Timeout after 5 minutes
  setTimeout(
    () => {
      if (server.listening) {
        server.close();
      }
      settleResult({
        success: false,
        error: "Authentication timeout - please try again",
      });
    },
    5 * 60 * 1000
  );

  return { port, resultPromise };
}

/**
 * Initiate browser-based OAuth login flow
 */
export async function initiateLogin(): Promise<AuthResult> {
  const state = generateState();

  // Start local callback server first
  const { port, resultPromise } = await startCallbackServer(state);

  // Build auth URL with state
  const authUrl = new URL(AUTH_CLI_URL);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("callback_port", port.toString());

  logger.info("\n🔐 Opening browser for authentication...");
  logger.info(
    `\nIf the browser doesn't open automatically, visit:\n${authUrl.toString()}\n`
  );

  // Open browser
  try {
    openBrowser(authUrl.toString());
  } catch (error) {
    logger.warn(
      "Failed to open browser automatically. Please open the URL manually."
    );
  }

  // Wait for callback
  const result = await resultPromise;

  if (result.success && result.tokens) {
    // Save tokens to disk
    await saveAuthTokens(result.tokens);
  }

  return result;
}

/**
 * Refresh an expired access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<AuthResult> {
  try {
    // Load existing tokens to preserve model preferences and user email
    const existingTokens = await loadAuthTokens();

    logger.debug("Attempting to refresh access token...");

    const response = await fetch(buildAuthApiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Token refresh failed: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorMessage = `Token refresh failed: ${errorJson.error}`;
        }
      } catch {
        // Use default error message
      }
      logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const tokens: AuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      // Respect backend expiration if provided, otherwise tokens persist indefinitely
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : undefined,
      selectedModels: existingTokens?.selectedModels,
      userEmail: existingTokens?.userEmail,
      createdAt: existingTokens?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    // Log refresh details for debugging
    logger.debug("Token refreshed:", {
      hasRefreshToken: !!data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt: tokens.expiresAt,
    });

    await saveAuthTokens(tokens);

    return { success: true, tokens };
  } catch (error) {
    logger.error("Token refresh error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
