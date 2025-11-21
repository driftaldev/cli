import { GoogleGenAI } from "@google/genai";
import {
  LLMProvider,
  type LLMGenerateOptions,
  type LLMGenerateResponse,
  type LLMStreamChunk,
  type LLMMessage,
} from "../provider.js";
import type { LLMConfig } from "../../../config/schema.js";

export class GeminiProvider extends LLMProvider {
  private client: GoogleGenAI;

  constructor(config: LLMConfig) {
    super(config, "gemini");

    const geminiConfig = config.providers.gemini;
    if (!geminiConfig) {
      throw new Error(
        "Gemini configuration not found. Please run 'driftal login' or set GEMINI_API_KEY environment variable."
      );
    }

    // Get API key from config or environment
    const apiKey =
      geminiConfig.apiKey ||
      process.env[geminiConfig.apiKeyEnv || "GEMINI_API_KEY"];

    if (!apiKey) {
      throw new Error(
        `Gemini API key not found. Please run 'driftal login' to authenticate or set ${geminiConfig.apiKeyEnv} environment variable.`
      );
    }

    this.client = new GoogleGenAI({ apiKey });
    this.modelName = geminiConfig.model || "gemini-2.0-flash-exp";
    this.maxTokens = geminiConfig.maxTokens || 8192;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResponse> {
    return this.retryWithBackoff(async () => {
      // Separate system messages from user/assistant messages
      const systemMessages = options.messages.filter(
        (m) => m.role === "system"
      );
      const conversationMessages = options.messages.filter(
        (m) => m.role !== "system"
      );

      // Combine system messages into one
      const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

      // Get the model instance
      const model = this.client.models.get(this.modelName);

      // Transform messages to Gemini format (use "model" instead of "assistant")
      const contents = conversationMessages.map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));

      const response = await model.generateContent({
        contents,
        ...(systemPrompt && {
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
        }),
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens || this.maxTokens,
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate) {
        throw new Error("No response generated from Gemini");
      }

      const content = candidate.content.parts
        .map((part) => part.text)
        .join("");

      return {
        content,
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
        model: this.modelName,
        finishReason: this.mapFinishReason(candidate.finishReason),
      };
    });
  }

  async *generateStream(
    options: LLMGenerateOptions
  ): AsyncGenerator<LLMStreamChunk> {
    const systemMessages = options.messages.filter((m) => m.role === "system");
    const conversationMessages = options.messages.filter(
      (m) => m.role !== "system"
    );

    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

    // Get the model instance
    const model = this.client.models.get(this.modelName);

    // Transform messages to Gemini format
    const contents = conversationMessages.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

    const stream = await model.generateContentStream({
      contents,
      ...(systemPrompt && {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
      }),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens || this.maxTokens,
      },
    });

    for await (const chunk of stream) {
      if (chunk.candidates && chunk.candidates[0]) {
        const candidate = chunk.candidates[0];
        const text = candidate.content?.parts?.[0]?.text;

        if (text) {
          yield {
            delta: text,
            done: false,
          };
        }

        // Check if this is the final chunk
        if (candidate.finishReason && candidate.finishReason !== "UNSPECIFIED") {
          yield {
            delta: "",
            done: true,
          };
        }
      }
    }
  }

  countTokens(text: string): number {
    // Approximate token count (Gemini uses similar tokenization to GPT)
    return Math.ceil(text.length / 4);
  }

  private mapFinishReason(
    reason: string | undefined
  ): "stop" | "length" | "content_filter" | "tool_calls" {
    switch (reason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
        return "content_filter";
      default:
        return "stop";
    }
  }
}
