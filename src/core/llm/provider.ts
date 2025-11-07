import type { LLMConfig } from "../../config/schema.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGenerateOptions {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMGenerateResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: "stop" | "length" | "content_filter" | "tool_calls";
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
}

export abstract class LLMProvider {
  protected config: LLMConfig;
  protected providerName: string;
  protected modelName: string;
  protected maxTokens: number;

  constructor(config: LLMConfig, providerName: string) {
    this.config = config;
    this.providerName = providerName;
    this.modelName = "";
    this.maxTokens = 4096;
  }

  abstract generate(options: LLMGenerateOptions): Promise<LLMGenerateResponse>;

  async *generateStream(options: LLMGenerateOptions): AsyncGenerator<LLMStreamChunk> {
    // Default implementation: non-streaming providers can override
    const response = await this.generate(options);
    yield { delta: response.content, done: false };
    yield { delta: "", done: true };
  }

  abstract countTokens(text: string): number;

  getModelName(): string {
    return this.modelName;
  }

  getProviderName(): string {
    return this.providerName;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * Retry logic with exponential backoff
   */
  protected async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain errors
        if (this.isNonRetriableError(error)) {
          throw error;
        }

        if (i < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error("Max retries exceeded");
  }

  /**
   * Check if an error should not be retried
   */
  protected isNonRetriableError(error: any): boolean {
    // Authentication errors
    if (error.status === 401 || error.status === 403) {
      return true;
    }

    // Invalid request errors
    if (error.status === 400) {
      return true;
    }

    return false;
  }
}
