import type { ScoutConfig } from "../config/schema.js";

export interface CloudAuthContext {
  indexerHeader?: string;
  redisPassword?: string;
}

export interface CloudAuthWarnings {
  missingIndexerConfig?: boolean;
  missingIndexerEnvVar?: string;
  missingRedisEnvVar?: string;
}

export interface CloudAuthResolution
  extends CloudAuthContext,
    CloudAuthWarnings {}

export function resolveCloudAuth(config: ScoutConfig): CloudAuthResolution {
  if (!config.cloud?.enabled) {
    return {};
  }

  const result: CloudAuthResolution = {};

  const indexerEnvKey = config.cloud.api_key_env;

  const resolvedApiKey =
    config.cloud.api_key ??
    (indexerEnvKey ? process.env[indexerEnvKey] : undefined);

  if (resolvedApiKey) {
    result.indexerHeader = `Bearer ${resolvedApiKey}`;
  }

  if (!resolvedApiKey) {
    if (!indexerEnvKey) {
      result.missingIndexerConfig = true;
    } else {
      result.missingIndexerEnvVar = indexerEnvKey;
    }
  }

  if (config.cloud.redis_url) {
    if (resolvedApiKey) {
      result.redisPassword = resolvedApiKey;
    } else if (indexerEnvKey) {
      result.missingRedisEnvVar = indexerEnvKey;
    } else {
      result.missingIndexerConfig = true;
    }
  }

  return result;
}
