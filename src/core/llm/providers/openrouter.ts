import OpenAI from "openai";
import {
  LLMProvider,
  type LLMGenerateOptions,
  type LLMGenerateResponse,
  type LLMStreamChunk,
} from "../provider.js";
import type { LLMConfig } from "../../../config/schema.js";

export class OpenRouterProvider extends LLMProvider {
  private client: OpenAI;

  constructor(config: LLMConfig) {
    super(config, "openrouter");

    const openrouterConfig = config.providers.openrouter;
    if (!openrouterConfig) {
      throw new Error(
        "OpenRouter configuration not found. Please run 'driftal login' or set OPENROUTER_API_KEY environment variable."
      );
    }

    // Get API key from config or environment
    const apiKey =
      openrouterConfig.apiKey ||
      process.env[openrouterConfig.apiKeyEnv || "OPENROUTER_API_KEY"];

    if (!apiKey) {
      throw new Error(
        `OpenRouter API key not found. Please run 'driftal login' to authenticate or set ${openrouterConfig.apiKeyEnv} environment variable.`
      );
    }

    // Initialize OpenAI client with OpenRouter base URL
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://scoutlab.ai", // Required by OpenRouter for attribution
        "X-Title": "ScoutLab", // Required by OpenRouter for attribution
      },
    });

    this.modelName = openrouterConfig.model || "anthropic/claude-sonnet-4.5";
    this.maxTokens = openrouterConfig.maxTokens || 8192;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResponse> {
    return this.retryWithBackoff(async () => {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature ?? 0.7,
        messages: options.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error("No response from OpenRouter");
      }

      return {
        content: choice.message.content || "",
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
        model: response.model,
        finishReason: this.mapFinishReason(choice.finish_reason),
      };
    });
  }

  async *generateStream(
    options: LLMGenerateOptions
  ): AsyncGenerator<LLMStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.modelName,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? 0.7,
      messages: options.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      const finishReason = chunk.choices[0]?.finish_reason;

      if (delta) {
        yield {
          delta,
          done: false,
        };
      }

      if (finishReason) {
        yield {
          delta: "",
          done: true,
        };
      }
    }
  }

  countTokens(text: string): number {
    // Approximate token count for Claude models (~4 chars per token)
    return Math.ceil(text.length / 4);
  }

  private mapFinishReason(
    reason: string | null | undefined
  ): "stop" | "length" | "content_filter" | "tool_calls" {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      case "tool_calls":
        return "tool_calls";
      default:
        return "stop";
    }
  }
}
