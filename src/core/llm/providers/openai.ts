import OpenAI from "openai";
import {
  LLMProvider,
  type LLMGenerateOptions,
  type LLMGenerateResponse,
  type LLMStreamChunk,
} from "../provider.js";
import type { LLMConfig } from "../../../config/schema.js";

export class OpenAIProvider extends LLMProvider {
  private client: OpenAI;

  constructor(config: LLMConfig) {
    super(config, "openai");

    const openaiConfig = config.providers.openai;
    if (!openaiConfig) {
      throw new Error(
        "OpenAI configuration not found. Please run 'driftal login' or set OPENAI_API_KEY environment variable."
      );
    }

    // Get API key from config or environment
    const apiKey =
      openaiConfig.apiKey ||
      process.env[openaiConfig.apiKeyEnv || "OPENAI_API_KEY"];

    if (!apiKey) {
      throw new Error(
        `OpenAI API key not found. Please run 'driftal login' to authenticate or set ${openaiConfig.apiKeyEnv} environment variable.`
      );
    }

    this.client = new OpenAI({ apiKey });
    this.modelName = openaiConfig.model || "gpt-4-turbo";
    this.maxTokens = openaiConfig.maxTokens || 4096;
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
        throw new Error("No response from OpenAI");
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
    // Approximate token count for GPT models (~4 chars per token)
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
