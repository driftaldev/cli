import { spawn } from "child_process";
import * as http from "http";
import { AuthTokens, saveAuthTokens } from "./token-manager.js";
import { logger } from "./logger.js";

// Default auth endpoint - can be overridden via env var
const AUTH_BASE_URL = process.env.SCOUT_AUTH_URL || "http://localhost:3000";
const AUTH_CLI_URL =
  process.env.SCOUT_CLI_AUTH_URL || "http://localhost:3000/cli/auth";

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
          throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
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
          expiresAt: tokenData.expires_in
            ? Date.now() + tokenData.expires_in * 1000
            : undefined,
          userEmail: tokenData.user_email,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

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
        logger.error("Token exchange error:", error);

        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Token Exchange Failed</h1>
                <p>Please try again or contact support.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);

        server.close();
        settleResult({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
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
  setTimeout(() => {
    if (server.listening) {
      server.close();
    }
    settleResult({
      success: false,
      error: "Authentication timeout - please try again",
    });
  }, 5 * 60 * 1000);

  return { port, resultPromise };
}

/**
 * Initiate browser-based OAuth login flow
 */
export async function initiateLogin(selectedModels?: {
  primary: string;
  fallback?: string;
}): Promise<AuthResult> {
  const state = generateState();

  // Start local callback server first
  const { port, resultPromise } = await startCallbackServer(state);

  // Build auth URL with state
  const authUrl = new URL(AUTH_CLI_URL);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("callback_port", port.toString());

  if (selectedModels) {
    authUrl.searchParams.set("primary_model", selectedModels.primary);
    if (selectedModels.fallback) {
      authUrl.searchParams.set("fallback_model", selectedModels.fallback);
    }
  }

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
    // Save selected models to tokens
    if (selectedModels) {
      result.tokens.selectedModels = selectedModels;
    }

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
    const response = await fetch(buildAuthApiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const tokens: AuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

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
