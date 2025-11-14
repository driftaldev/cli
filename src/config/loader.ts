import { loadAuthTokens } from "../utils/token-manager.js";
import { fetchMossCredentials } from "../utils/moss-credentials.js";
import { DEFAULT_INDEX_DIRECTORY } from "./constants.js";
import {
  ScoutConfigSchema,
  type ScoutConfig,
  type LLMConfig,
} from "./schema.js";

// Re-export types for convenience
export type { ScoutConfig, LLMConfig };

/**
 * Load configuration by fetching credentials from backend
 * Requires authentication - will throw error if not authenticated
 */
export async function loadConfig(): Promise<ScoutConfig> {
  try {
    // Fetch Moss credentials from backend
    const mossCredentials = await fetchMossCredentials();

    // Build minimal config object
    const config: ScoutConfig = {
      moss: {
        index_directory: DEFAULT_INDEX_DIRECTORY,
        project_id: mossCredentials.project_id,
        project_key: mossCredentials.project_key,
      },
    };

    // Validate with schema (ensures type safety)
    return ScoutConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to load configuration: ${error.message}`
      );
    }
    throw new Error("Failed to load configuration from backend");
  }
}

/**
 * Load LLM configuration with cloud proxy support
 * Priority order:
 * 1. Cloud proxy auth (if tokens exist in ~/.driftal/auth.json)
 * 2. Config file LLM settings
 * 3. Direct API keys from environment variables
 */
export async function loadLLMConfig(
  baseConfig?: Partial<LLMConfig>
): Promise<LLMConfig> {
  // Check for cloud authentication tokens
  const authTokens = await loadAuthTokens();

  if (authTokens) {
    // User is authenticated via cloud proxy - use cloud proxy mode (tokens persist until manual logout)
    return {
      providers: {
        primary: "cloud-proxy" as const,
        cloudProxy: {
          enabled: true,
          accessToken: authTokens.accessToken,
          refreshToken: authTokens.refreshToken,
          selectedModels: authTokens.selectedModels,
        },
      },
      rateLimits: baseConfig?.rateLimits || {
        requestsPerMinute: 50,
        tokensPerMinute: 100000,
      },
    };
  }

  // No cloud auth - use traditional provider config
  // Check for direct API keys in environment
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (baseConfig) {
    // Use provided config
    return baseConfig as LLMConfig;
  }

  // Build config from environment variables if available
  if (anthropicKey || openaiKey) {
    return {
      providers: {
        primary: openaiKey ? "openai" : "anthropic",
        cloudProxy: { enabled: false },
        ...(anthropicKey && {
          anthropic: {
            apiKey: anthropicKey,
            apiKeyEnv: "ANTHROPIC_API_KEY",
            model: "claude-3-5-sonnet-20241022",
            maxTokens: 8192,
          },
        }),
        ...(openaiKey && {
          openai: {
            apiKey: openaiKey,
            apiKeyEnv: "OPENAI_API_KEY",
            model: "gpt-4-turbo",
            maxTokens: 4096,
          },
        }),
      },
      rateLimits: {
        requestsPerMinute: 50,
        tokensPerMinute: 100000,
      },
    };
  }

  // No config found - throw error
  throw new Error(
    "No LLM configuration found. Please run 'driftal login' to authenticate or set ANTHROPIC_API_KEY/OPENAI_API_KEY environment variables."
  );
}
