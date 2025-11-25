import type { LanguageModelV2 } from "@ai-sdk/provider-v5";

export type AgentModelConfig =
  | string
  | LanguageModelV2
  | {
      id: string;
      url?: string;
      apiKey?: string;
      headers?: Record<string, string>;
      providerId?: string;
      modelId?: string;
    };



