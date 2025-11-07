import {
  LLMProvider,
  type LLMGenerateOptions,
  type LLMGenerateResponse,
  type LLMStreamChunk
} from "../provider.js";
import type { LLMConfig } from "../../../config/schema.js";

export class OllamaProvider extends LLMProvider {
  private baseUrl: string;

  constructor(config: LLMConfig) {
    super(config, "ollama");

    const ollamaConfig = config.providers.ollama;
    if (!ollamaConfig) {
      throw new Error("Ollama configuration not found");
    }

    this.baseUrl = ollamaConfig.baseUrl || "http://localhost:11434";
    this.modelName = ollamaConfig.model || "codellama";
    this.maxTokens = ollamaConfig.maxTokens || 4096;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResponse> {
    return this.retryWithBackoff(async () => {
      // Format messages for Ollama
      const prompt = this.formatMessages(options.messages);

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.modelName,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            num_predict: options.maxTokens || this.maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data: any = await response.json();

      const promptTokens = this.countTokens(prompt);
      const completionTokens = this.countTokens(data.response);

      return {
        content: data.response,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens
        },
        model: this.modelName,
        finishReason: data.done ? "stop" : "length"
      };
    });
  }

  async *generateStream(options: LLMGenerateOptions): AsyncGenerator<LLMStreamChunk> {
    const prompt = this.formatMessages(options.messages);

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.modelName,
        prompt,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens || this.maxTokens
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        yield { delta: "", done: true };
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.response) {
            yield {
              delta: data.response,
              done: false
            };
          }
          if (data.done) {
            yield { delta: "", done: true };
          }
        } catch (e) {
          // Skip invalid JSON lines
          continue;
        }
      }
    }
  }

  countTokens(text: string): number {
    // Approximate token count (~4 chars per token)
    return Math.ceil(text.length / 4);
  }

  /**
   * Format messages for Ollama's prompt format
   */
  private formatMessages(messages: { role: string; content: string }[]): string {
    return messages
      .map((msg) => {
        switch (msg.role) {
          case "system":
            return `System: ${msg.content}`;
          case "user":
            return `User: ${msg.content}`;
          case "assistant":
            return `Assistant: ${msg.content}`;
          default:
            return msg.content;
        }
      })
      .join("\n\n");
  }
}
