import fs from "fs/promises";
import path from "path";
import YAML from "yaml";

import { loadAuthTokens } from "../utils/token-manager.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  ScoutConfigSchema,
  type ScoutConfig,
  type LLMConfig,
} from "./schema.js";

// Re-export types for convenience
export type { ScoutConfig, LLMConfig };

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (isPlainObject(value)) {
    const clone: PlainObject = {};
    for (const [key, val] of Object.entries(value)) {
      clone[key] = deepClone(val);
    }
    return clone as T;
  }

  return value;
}

function deepMerge(target: PlainObject, source: PlainObject): PlainObject {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      target[key] = value.map((item) =>
        isPlainObject(item) ? deepMerge({}, item) : deepClone(item)
      );
      continue;
    }

    if (isPlainObject(value)) {
      const current = target[key];
      const base = isPlainObject(current) ? current : {};
      target[key] = deepMerge({ ...base }, value);
      continue;
    }

    target[key] = value;
  }

  return target;
}

async function readYamlObjectIfExists(
  filePath: string
): Promise<PlainObject | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = YAML.parse(raw);

    if (parsed === undefined || parsed === null) {
      return {};
    }

    if (!isPlainObject(parsed)) {
      throw new Error(`Config file ${filePath} must contain a YAML object.`);
    }

    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function buildCandidatePaths(target: string, directories: string[]): string[] {
  if (path.isAbsolute(target)) {
    return [target];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const dir of directories) {
    const resolved = path.resolve(dir, target);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }

  return result;
}

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = contents.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const cleaned = line.startsWith("export ")
      ? line.slice("export ".length)
      : line;
    const eqIndex = cleaned.indexOf("=");
    if (eqIndex === -1) continue;

    const key = cleaned.slice(0, eqIndex).trim();
    if (!key) continue;

    let value = cleaned.slice(eqIndex + 1).trim();
    if (!value) {
      result[key] = "";
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function normalizeConfigPath(configPath?: string): string {
  if (!configPath) {
    // Use process.cwd() to get the directory where the user ran the command
    return path.join(process.cwd(), ".driftal", "config.yaml");
  }
  return path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);
}

export async function loadConfig(configPath?: string): Promise<ScoutConfig> {
  const resolvedConfigPath = normalizeConfigPath(configPath);
  const mergedConfig = deepClone(DEFAULT_CONFIG) as PlainObject;

  const configDirs: string[] = [];

  const baseConfig = await readYamlObjectIfExists(resolvedConfigPath);
  if (baseConfig) {
    deepMerge(mergedConfig, baseConfig);
    configDirs.push(path.dirname(resolvedConfigPath));
  }

  if (!configPath) {
    const overrideCandidates = [
      path.join(process.cwd(), "scout.yaml"),
      path.join(path.dirname(resolvedConfigPath), "scout.yaml"),
    ];
    const seen = new Set<string>();
    for (const candidate of overrideCandidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const overrideConfig = await readYamlObjectIfExists(candidate);
      if (!overrideConfig) continue;
      deepMerge(mergedConfig, overrideConfig);
      configDirs.push(path.dirname(candidate));
    }
  }

  if (!configDirs.includes(process.cwd())) {
    configDirs.push(process.cwd());
  }

  const searchDirectories = configDirs
    .map((dir) => path.resolve(dir))
    .filter((dir, index, array) => array.indexOf(dir) === index)
    .reverse();

  const parsed = ScoutConfigSchema.parse(mergedConfig);

  if (parsed.cloud?.enabled) {
    const cloudConfig = parsed.cloud;
    const cloudIndexerUrl = parsed.cloud.indexer_url;
    const cloudRedisUrl = parsed.cloud.redis_url;
    const cloudApiKeyEnv = parsed.cloud.api_key_env;

    let resolvedApiKey = cloudConfig.api_key;

    if (!resolvedApiKey && cloudConfig.api_key_file) {
      const candidates = buildCandidatePaths(
        cloudConfig.api_key_file,
        searchDirectories
      );
      let lastError: NodeJS.ErrnoException | undefined;

      for (const candidate of candidates) {
        try {
          const fileContents = await fs.readFile(candidate, "utf8");
          const trimmed = fileContents.trim();
          if (!trimmed) {
            throw new Error("API key file was empty");
          }
          resolvedApiKey = trimmed;
          break;
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code === "ENOENT") {
            lastError = err;
            continue;
          }
          throw error;
        }
      }

      if (!resolvedApiKey) {
        if (lastError) throw lastError;
        throw new Error("API key file was empty");
      }
    }

    if (!resolvedApiKey && cloudConfig.secrets_file) {
      if (!cloudApiKeyEnv) {
        console.warn(
          "[ScoutCode] cloud.secrets_file specified but cloud.api_key_env is missing; unable to resolve API key."
        );
      } else {
        const candidates = buildCandidatePaths(
          cloudConfig.secrets_file,
          searchDirectories
        );
        let secretsPathUsed: string | undefined;
        let fileFound = false;

        for (const candidate of candidates) {
          try {
            const secretsRaw = await fs.readFile(candidate, "utf8");
            fileFound = true;
            secretsPathUsed = candidate;
            const secrets = parseEnvFile(secretsRaw);
            const secretValue = secrets[cloudApiKeyEnv];
            if (secretValue) {
              resolvedApiKey = secretValue;
              break;
            }
            console.warn(
              `[ScoutCode] ${cloudApiKeyEnv} not found in secrets file ${candidate}.`
            );
          } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === "ENOENT") {
              continue;
            }
            console.warn(
              `[ScoutCode] Failed to read cloud secrets_file ${candidate}: ${err.message}`
            );
          }
        }

        if (!fileFound && candidates.length > 0) {
          console.warn(
            `[ScoutCode] Cloud secrets_file ${candidates[0]} was not found.`
          );
        }

        if (!resolvedApiKey && fileFound && secretsPathUsed) {
          // Already logged missing env variable; no further action.
        }
      }
    }

    if (cloudApiKeyEnv) {
      const existingEnv = process.env[cloudApiKeyEnv];
      if (existingEnv && !resolvedApiKey) {
        resolvedApiKey = existingEnv;
      }
    }

    if (resolvedApiKey) {
      parsed.cloud = {
        ...cloudConfig,
        api_key: resolvedApiKey,
      };
    }

    if (cloudIndexerUrl) {
      parsed.indexer_service = {
        ...parsed.indexer_service,
        url: cloudIndexerUrl,
        auto_start: false,
      };
    }
    if (cloudRedisUrl) {
      parsed.cache = {
        ...parsed.cache,
        redis_url: cloudRedisUrl,
      };
    }
  }

  return parsed;
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
