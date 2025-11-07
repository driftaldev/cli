import { z } from "zod";

export const RepoConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  watch: z.boolean().default(false)
});

export const CacheConfigSchema = z.object({
  redis_url: z.string().url(),
  default_ttl: z.number().int().positive().default(86400)
});

export const IndexerServiceSchema = z.object({
  url: z.string().url(),
  auto_start: z.boolean().default(true),
  timeout: z.number().int().positive().default(100000000)
});

export const GitConfigSchema = z.object({
  auto_index_on_commit: z.boolean().default(true)
});

export const IndexingConfigSchema = z.object({
  file_extensions: z.array(z.string()),
  exclude_patterns: z.array(z.string())
});

export const CloudConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    indexer_url: z.string().url().optional(),
    redis_url: z.string().url().optional(),
    api_key_env: z.string().min(1).optional(),
    api_key: z.string().min(1).optional(),
    api_key_file: z.string().min(1).optional(),
    secrets_file: z.string().min(1).optional()
  })
  .superRefine((config, ctx) => {
    if (!config.enabled) return;
    if (!config.indexer_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "When cloud hosting is enabled, indexer_url must be provided"
      });
    }
    if (!config.redis_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "When cloud hosting is enabled, redis_url must be provided"
      });
    }
    const hasSecretConfig =
      Boolean(config.api_key_env) ||
      Boolean(config.api_key) ||
      Boolean(config.api_key_file) ||
      Boolean(config.secrets_file);
    if (!hasSecretConfig) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "When cloud hosting is enabled, you must provide api_key_env, api_key, api_key_file, or secrets_file"
      });
    }

    if (config.api_key && config.api_key_env) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Specify either api_key or api_key_env (with optional file), but not both."
      });
    }

    if (config.api_key && config.api_key_file) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "When api_key is provided inline, api_key_file should be omitted."
      });
    }

    if (config.api_key && config.secrets_file) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "When api_key is provided inline, secrets_file should be omitted."
      });
    }

    if (!config.api_key_env && (config.api_key_file || config.secrets_file)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "api_key_env is required when using api_key_file or secrets_file."
      });
    }
  });

export const MossConfigSchema = z.object({
  index_directory: z.string().default(".scout-code/indexes"),
  project_id: z.string(),
  project_key: z.string()
});

// Cloud Proxy Configuration for LLM
export const CloudProxyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  proxyUrl: z.string().url().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  selectedModels: z.object({
    primary: z.string(),
    fallback: z.string().optional()
  }).optional()
});

// LLM Provider Configuration
export const LLMProviderConfigSchema = z.object({
  // Cloud proxy is the default mode
  cloudProxy: CloudProxyConfigSchema.default({ enabled: true }),

  // Traditional provider config (for advanced users with their own API keys)
  primary: z.enum(["anthropic", "openai", "ollama", "cloud-proxy"]).default("cloud-proxy"),
  fallback: z.enum(["anthropic", "openai", "ollama"]).optional(),
  anthropic: z.object({
    apiKey: z.string().optional(),
    apiKeyEnv: z.string().default("ANTHROPIC_API_KEY"),
    model: z.string().default("claude-3-5-sonnet-20241022"),
    maxTokens: z.number().int().positive().default(8192)
  }).optional(),
  openai: z.object({
    apiKey: z.string().optional(),
    apiKeyEnv: z.string().default("OPENAI_API_KEY"),
    model: z.string().default("gpt-4-turbo"),
    maxTokens: z.number().int().positive().default(4096)
  }).optional(),
  ollama: z.object({
    baseUrl: z.string().url().default("http://localhost:11434"),
    model: z.string().default("codellama"),
    maxTokens: z.number().int().positive().default(4096)
  }).optional()
});

export const RateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().int().positive().default(50),
  tokensPerMinute: z.number().int().positive().default(100000)
});

export const LLMConfigSchema = z.object({
  providers: LLMProviderConfigSchema.default({ primary: "anthropic" }),
  rateLimits: RateLimitConfigSchema.default({
    requestsPerMinute: 50,
    tokensPerMinute: 100000
  })
});

// Mastra Configuration (always enabled)
export const MastraConfigSchema = z.object({
  memory: z.object({
    enabled: z.boolean().default(true),
    storageDir: z.string().default('.scout-code/memory'),
    vectorDb: z.enum(['local', 'redis']).default('local')
  }).default({ enabled: true, storageDir: '.scout-code/memory', vectorDb: 'local' }),
  workflows: z.object({
    parallel: z.boolean().default(true),
    timeout: z.number().int().positive().default(300000) // 5 minutes
  }).default({ parallel: true, timeout: 300000 }),
  agents: z.object({
    temperature: z.object({
      security: z.number().min(0).max(1).default(0.2),
      performance: z.number().min(0).max(1).default(0.3),
      logic: z.number().min(0).max(1).default(0.3)
    }).default({ security: 0.2, performance: 0.3, logic: 0.3 }),
    maxSteps: z.number().int().positive().default(3)
  }).default({
    temperature: { security: 0.2, performance: 0.3, logic: 0.3 },
    maxSteps: 3
  })
});

// Review Configuration
export const ReviewConfigSchema = z.object({
  severity: z.object({
    minimum: z.enum(["critical", "high", "medium", "low", "info"]).default("low"),
    failOn: z.enum(["critical", "high", "medium"]).optional()
  }).default({ minimum: "low" }),
  analyzers: z.object({
    logic: z.object({
      enabled: z.boolean().default(true),
      strictness: z.number().min(0).max(1).default(0.7)
    }).default({ enabled: true, strictness: 0.7 }),
    security: z.object({
      enabled: z.boolean().default(true),
      checks: z.array(z.string()).default(["all"])
    }).default({ enabled: true, checks: ["all"] }),
    performance: z.object({
      enabled: z.boolean().default(true),
      thresholds: z.object({
        complexity: z.number().int().positive().default(10)
      }).default({ complexity: 10 })
    }).default({ enabled: true, thresholds: { complexity: 10 } }),
    patterns: z.object({
      enabled: z.boolean().default(true),
      customRules: z.array(z.string()).default([])
    }).default({ enabled: true, customRules: [] })
  }).default({
    logic: { enabled: true, strictness: 0.7 },
    security: { enabled: true, checks: ["all"] },
    performance: { enabled: true, thresholds: { complexity: 10 } },
    patterns: { enabled: true, customRules: [] }
  }),
  autoFix: z.object({
    enabled: z.boolean().default(false),
    safeOnly: z.boolean().default(true),
    require: z.enum(["always", "prompt", "never"]).default("prompt")
  }).default({ enabled: false, safeOnly: true, require: "prompt" }),
  include: z.array(z.string()).default(["**/*"]),
  exclude: z.array(z.string()).default(["**/node_modules/**", "**/dist/**", "**/*.test.*"]),
  languages: z.record(z.object({
    enabled: z.boolean().default(true),
    style: z.string().optional(),
    customRules: z.array(z.string()).default([])
  })).default({}),
  memory: z.object({
    enabled: z.boolean().default(true),
    learnFromFeedback: z.boolean().default(true),
    shareAcrossRepos: z.boolean().default(false)
  }).default({ enabled: true, learnFromFeedback: true, shareAcrossRepos: false }),
  cache: z.object({
    enabled: z.boolean().default(true),
    ttl: z.number().int().positive().default(86400)
  }).default({ enabled: true, ttl: 86400 }),
  output: z.object({
    format: z.enum(["text", "json", "markdown"]).default("text"),
    verbose: z.boolean().default(false),
    groupBy: z.enum(["severity", "type", "file"]).default("severity")
  }).default({ format: "text", verbose: false, groupBy: "severity" }),
  mastra: MastraConfigSchema.optional()
});

// Hyperspell (Memory) Configuration
export const HyperspellConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().default("HYPERSPELL_API_KEY"),
  localMode: z.boolean().default(true),
  storageDir: z.string().default(".scout-code/memory")
});

export const ScoutConfigSchema = z.object({
  version: z.number().int(),
  indexer_service: IndexerServiceSchema,
  repos: z.array(RepoConfigSchema),
  cache: CacheConfigSchema,
  git: GitConfigSchema,
  indexing: IndexingConfigSchema,
  cloud: CloudConfigSchema.default({ enabled: false }),
  moss: MossConfigSchema,
  llm: LLMConfigSchema.optional(),
  review: ReviewConfigSchema.optional(),
  hyperspell: HyperspellConfigSchema.optional()
});

export type CloudConfig = z.infer<typeof CloudConfigSchema>;
export type CloudProxyConfig = z.infer<typeof CloudProxyConfigSchema>;
export type MossConfig = z.infer<typeof MossConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type MastraConfig = z.infer<typeof MastraConfigSchema>;
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>;
export type HyperspellConfig = z.infer<typeof HyperspellConfigSchema>;
export type ScoutConfig = z.infer<typeof ScoutConfigSchema>;
