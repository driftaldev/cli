import Anthropic from "@anthropic-ai/sdk";
import {
  LLMProvider,
  type LLMGenerateOptions,
  type LLMGenerateResponse,
  type LLMStreamChunk,
  type LLMMessage
} from "../provider.js";
import type { LLMConfig } from "../../../config/schema.js";

export class AnthropicProvider extends LLMProvider {
  private client: Anthropic;

  constructor(config: LLMConfig) {
    super(config, "anthropic");

    const anthropicConfig = config.providers.anthropic;
    if (!anthropicConfig) {
      throw new Error(
        "Anthropic configuration not found. Please run 'scoutcli login' or set ANTHROPIC_API_KEY environment variable."
      );
    }

    // Get API key from config or environment
    const apiKey =
      anthropicConfig.apiKey ||
      process.env[anthropicConfig.apiKeyEnv || "ANTHROPIC_API_KEY"];

    if (!apiKey) {
      throw new Error(
        `Anthropic API key not found. Please run 'scoutcli login' to authenticate or set ${anthropicConfig.apiKeyEnv} environment variable.`
      );
    }

    this.client = new Anthropic({ apiKey });
    this.modelName = anthropicConfig.model || "claude-3-5-sonnet-20241022";
    this.maxTokens = anthropicConfig.maxTokens || 8192;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResponse> {
    return this.retryWithBackoff(async () => {
      // Separate system messages from user/assistant messages
      const systemMessages = options.messages.filter((m) => m.role === "system");
      const conversationMessages = options.messages.filter((m) => m.role !== "system");

      // Combine system messages into one
      const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

      const response = await this.client.messages.create({
        model: this.modelName,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature ?? 0.7,
        system: systemPrompt || undefined,
        messages: conversationMessages.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content
        }))
      });

      const content = response.content
        .filter((block) => block.type === "text")
        .map((block) => (block as any).text)
        .join("");

      return {
        content,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens
        },
        model: response.model,
        finishReason: this.mapStopReason(response.stop_reason)
      };
    });
  }

  async *generateStream(options: LLMGenerateOptions): AsyncGenerator<LLMStreamChunk> {
    const systemMessages = options.messages.filter((m) => m.role === "system");
    const conversationMessages = options.messages.filter((m) => m.role !== "system");

    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? 0.7,
      system: systemPrompt || undefined,
      messages: conversationMessages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content
      })),
      stream: true
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield {
          delta: event.delta.text,
          done: false
        };
      } else if (event.type === "message_stop") {
        yield {
          delta: "",
          done: true
        };
      }
    }
  }

  countTokens(text: string): number {
    // Approximate token count (Claude uses ~4 chars per token)
    return Math.ceil(text.length / 4);
  }

  private mapStopReason(
    reason: string | null
  ): "stop" | "length" | "content_filter" | "tool_calls" {
    switch (reason) {
      case "end_turn":
        return "stop";
      case "max_tokens":
        return "length";
      case "stop_sequence":
        return "stop";
      default:
        return "stop";
    }
  }
}
