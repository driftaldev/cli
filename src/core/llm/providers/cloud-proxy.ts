import {
  LLMProvider,
  type LLMMessage,
  type LLMGenerateOptions,
  type LLMGenerateResponse,
  type LLMStreamChunk,
} from "../provider.js";
import { loadAuthTokens, AuthTokens } from "../../../utils/token-manager.js";
import { logger } from "../../../utils/logger.js";

const CLOUD_PROXY_URL =
  process.env.SCOUT_PROXY_URL || "https://auth.driftal.dev/v1";

export interface CloudProxyConfig {
  proxyUrl?: string;
  timeout?: number;
}

/**
 * Cloud proxy provider that routes LLM requests through Driftal's backend
 * This eliminates the need for users to manage their own API keys
 */
export class CloudProxyProvider extends LLMProvider {
  private proxyUrl: string;
  private timeout: number;
  private tokens: AuthTokens | null = null;

  constructor(config?: CloudProxyConfig) {
    super({} as any, "cloud-proxy");
    this.proxyUrl = config?.proxyUrl || CLOUD_PROXY_URL;
    this.timeout = config?.timeout || 60000; // 60 second default
    this.modelName = "cloud-proxy";
    this.maxTokens = 8192;
  }

  async countTokens(text: string): Promise<number> {
    // Simple approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Load and validate authentication tokens
   */
  private async ensureAuthenticated(): Promise<string> {
    // Load tokens if not cached
    if (!this.tokens) {
      this.tokens = await loadAuthTokens();
    }

    if (!this.tokens) {
      throw new Error(
        "Not authenticated. Please run 'scoutcli login' to authenticate."
      );
    }

    return this.tokens.accessToken;
  }

  /**
   * Make authenticated request to cloud proxy
   */
  private async makeRequest(
    endpoint: string,
    body: any,
    stream: boolean = false
  ): Promise<Response> {
    const accessToken = await this.ensureAuthenticated();

    const url = `${this.proxyUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-Scout-CLI-Version": "1.0.0", // TODO: get from package.json
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 - token might be invalid even after refresh
      if (response.status === 401) {
        throw new Error(
          "Authentication failed. Please run 'scoutcli login' to re-authenticate."
        );
      }

      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Cloud proxy error (${response.status})`;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) {
            errorMessage = errorJson.error;
          }
        } catch {
          errorMessage = errorText || errorMessage;
        }

        throw new Error(errorMessage);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(`Request timeout after ${this.timeout}ms`);
        }
        throw error;
      }

      throw new Error("Unknown error during cloud proxy request");
    }
  }

  override async generate(
    request: LLMGenerateOptions
  ): Promise<LLMGenerateResponse> {
    logger.debug("Sending request to cloud proxy...");

    const requestBody = {
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stop_sequences: request.stopSequences,
    };

    const response = await this.makeRequest(
      "/v1/chat/completions",
      requestBody,
      false
    );
    const data = await response.json();

    // Handle OpenAI-style response format
    if (data.choices && data.choices.length > 0) {
      const choice = data.choices[0];
      const content = choice.message?.content || choice.text || "";

      return {
        content,
        stopReason:
          choice.finish_reason === "stop"
            ? "end_turn"
            : choice.finish_reason === "length"
            ? "max_tokens"
            : "end_turn",
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens || 0,
              outputTokens: data.usage.completion_tokens || 0,
            }
          : undefined,
      };
    }

    // Handle Anthropic-style response format
    if (data.content) {
      const textContent = Array.isArray(data.content)
        ? data.content.find((c: any) => c.type === "text")?.text || ""
        : data.content;

      return {
        content: textContent,
        stopReason: data.stop_reason || "end_turn",
        usage: data.usage
          ? {
              inputTokens: data.usage.input_tokens || 0,
              outputTokens: data.usage.output_tokens || 0,
            }
          : undefined,
      };
    }

    throw new Error("Unexpected response format from cloud proxy");
  }

  override async *generateStream(
    request: LLMGenerateOptions
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    logger.debug("Sending streaming request to cloud proxy...");

    const requestBody = {
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stop_sequences: request.stopSequences,
      stream: true,
    };

    const response = await this.makeRequest(
      "/v1/chat/completions",
      requestBody,
      true
    );

    if (!response.body) {
      throw new Error("No response body for streaming");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed || trimmed === "data: [DONE]") {
            continue;
          }

          if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6);

            try {
              const data = JSON.parse(jsonStr);

              // Handle OpenAI-style streaming
              if (data.choices && data.choices.length > 0) {
                const delta = data.choices[0].delta;
                if (delta?.content) {
                  yield {
                    type: "content_delta",
                    delta: delta.content,
                  };
                }
              }

              // Handle Anthropic-style streaming
              if (data.type === "content_block_delta") {
                if (data.delta?.text) {
                  yield {
                    type: "content_delta",
                    delta: data.delta.text,
                  };
                }
              }

              // Handle completion
              if (
                data.type === "message_stop" ||
                data.choices?.[0]?.finish_reason
              ) {
                yield {
                  type: "message_stop",
                  stopReason:
                    data.stop_reason ||
                    data.choices?.[0]?.finish_reason ||
                    "end_turn",
                };
              }
            } catch (error) {
              logger.warn("Failed to parse streaming chunk:", error);
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  supportsStreaming(): boolean {
    return true;
  }
}
