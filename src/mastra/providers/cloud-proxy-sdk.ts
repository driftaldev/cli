import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadAuthTokens, isTokenExpired } from "../../utils/token-manager.js";
import { refreshAccessToken } from "../../utils/auth.js";
import { logger } from "../../utils/logger.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_PROXY_URL =
  process.env.SCOUT_PROXY_URL || "https://auth.driftal.dev";

/**
 * Get CLI version from package.json
 */
function getCliVersion(): string {
  try {
    const packageJsonPath = join(__dirname, "../../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version ?? "dev";
  } catch (error) {
    logger.warn("Failed to read CLI version from package.json", error);
    return "dev";
  }
}

/**
 * Creates a Cloud Proxy provider instance compatible with Vercel AI SDK
 * This wraps the cloud proxy endpoint in a LanguageModelV2-compatible interface
 */
export async function createCloudProxyProvider() {
  // Load and validate tokens
  let tokens = await loadAuthTokens();

  if (!tokens?.accessToken) {
    throw new Error("Not authenticated. Please run 'driftal login'.");
  }

  // Refresh token if expired
  if (isTokenExpired(tokens)) {
    if (tokens.refreshToken) {
      logger.debug("Token expired, refreshing...");
      const refreshResult = await refreshAccessToken(tokens.refreshToken);
      if (refreshResult.success && refreshResult.tokens) {
        tokens = refreshResult.tokens;
      } else {
        throw new Error(
          "Token expired and refresh failed. Please run 'driftal login'."
        );
      }
    } else {
      throw new Error("Token expired. Please run 'driftal login'.");
    }
  }

  // Ensure URL has correct format
  const proxyUrl = DEFAULT_PROXY_URL.endsWith("/")
    ? `${DEFAULT_PROXY_URL}v1`
    : `${DEFAULT_PROXY_URL}/v1`;

  const cliVersion = getCliVersion();

  logger.debug("Creating cloud proxy provider", {
    proxyUrl,
    cliVersion,
  });

  return createOpenAICompatible({
    name: "cloud-proxy",
    baseURL: proxyUrl,
    apiKey: tokens.accessToken,
    headers: {
      "X-Driftal-CLI-Version": `driftal/${cliVersion}`,
    },
    includeUsage: true,
    supportsStructuredOutputs: false,
  });
}

/**
 * Gets a language model from the cloud proxy provider
 * @param modelId - Optional model ID to use. Falls back to selected model in auth.json
 * @returns A LanguageModelV2 instance that Mastra can use
 */
export async function getCloudProxyModel(modelId?: string) {
  const tokens = await loadAuthTokens();
  const selectedModel =
    modelId || tokens?.selectedModels?.primary || "openai/o3";

  logger.debug("Getting cloud proxy model", { selectedModel });

  const provider = await createCloudProxyProvider();
  return provider(selectedModel);
}
