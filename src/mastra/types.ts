export type AgentModelConfig =
  | string
  | {
      id: string;
      url?: string;
      apiKey?: string;
      headers?: Record<string, string>;
      providerId?: string;
      modelId?: string;
    };



