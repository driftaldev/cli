import {
  LLMProvider,
  type LLMMessage,
  type LLMGenerateOptions,
  type LLMGenerateResponse,
  type LLMStreamChunk,
} from "../provider.js";
import {
  loadAuthTokens,
  AuthTokens,
  isTokenExpired,
} from "../../../utils/token-manager.js";
import { refreshAccessToken } from "../../../utils/auth.js";
import { logger } from "../../../utils/logger.js";

const CLOUD_PROXY_URL =
  process.env.SCOUT_PROXY_URL || "https://auth.driftal.dev";

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

  countTokens(text: string): number {
    // Simple approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Load and validate authentication tokens
   * Automatically refreshes tokens if they're expired or about to expire
   */
  private async ensureAuthenticated(): Promise<string> {
    // Always reload tokens from disk to get the latest state
    // This handles cases where another process may have refreshed the tokens
    this.tokens = await loadAuthTokens();

    if (!this.tokens) {
      throw new Error(
        "Not authenticated. Please run 'driftal login' to authenticate."
      );
    }

    // Check if token is expired or about to expire
    // If expiresAt is undefined, token never expires (persists until manual logout)
    if (isTokenExpired(this.tokens)) {
      // Try to refresh the token if we have a refresh token
      if (this.tokens.refreshToken) {
        logger.debug("Access token expired, attempting to refresh...");
        try {
          const refreshResult = await refreshAccessToken(
            this.tokens.refreshToken
          );
          if (refreshResult.success && refreshResult.tokens) {
            this.tokens = refreshResult.tokens;
            logger.debug("Token refreshed successfully");
          } else {
            throw new Error(
              "Failed to refresh token. Please run 'driftal login' to re-authenticate."
            );
          }
        } catch (error) {
          logger.error("Token refresh failed", error);
          throw new Error(
            "Token expired and refresh failed. Please run 'driftal login' to re-authenticate."
          );
        }
      } else {
        throw new Error(
          "Token expired and no refresh token available. Please run 'driftal login' to re-authenticate."
        );
      }
    }

    return this.tokens.accessToken;
  }

  /**
   * Get the selected model from auth.json with fallback to default
   */
  private async getSelectedModel(): Promise<string> {
    // Ensure tokens are loaded
    await this.ensureAuthenticated();

    // Get model from auth.json, fallback to default
    const model = this.tokens?.selectedModels?.primary || "o3";

    return model;
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

      // Handle 401 - try to refresh token and retry once
      if (response.status === 401) {
        logger.debug("Received 401 Unauthorized from backend");

        // Reload tokens from disk first (another process may have refreshed)
        this.tokens = await loadAuthTokens();

        // Try to refresh the token if we have a refresh token
        if (this.tokens?.refreshToken) {
          logger.debug(
            "Received 401, attempting to refresh token and retry..."
          );
          try {
            const refreshResult = await refreshAccessToken(
              this.tokens.refreshToken
            );
            if (refreshResult.success && refreshResult.tokens) {
              this.tokens = refreshResult.tokens;
              logger.debug("Token refreshed, retrying request...");

              // Retry the request with the new token
              const retryResponse = await fetch(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${this.tokens.accessToken}`,
                  "X-Scout-CLI-Version": "1.0.0",
                },
                body: JSON.stringify(body),
                signal: controller.signal,
              });

              if (retryResponse.status === 401) {
                throw new Error(
                  "Authentication failed after token refresh. Please run 'driftal login' to re-authenticate."
                );
              }

              if (!retryResponse.ok) {
                const errorText = await retryResponse.text();
                let errorMessage = `Cloud proxy error (${retryResponse.status})`;

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

              return retryResponse;
            } else {
              const errorMsg = refreshResult.error || "Unknown error";
              logger.error("Token refresh failed:", errorMsg);
              throw new Error(
                `Failed to refresh token: ${errorMsg}. Please run 'driftal login' to re-authenticate.`
              );
            }
          } catch (error) {
            if (error instanceof Error && error.message.includes("refresh")) {
              throw error;
            }
            logger.error("Token refresh failed", error);
            throw new Error(
              "Authentication failed. Please run 'driftal login' to re-authenticate."
            );
          }
        } else {
          logger.warn("No refresh token available, cannot refresh");
          throw new Error(
            "Authentication failed and no refresh token available. Please run 'driftal login' to re-authenticate."
          );
        }
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

    // Get model from auth.json (~/.driftal/auth.json)
    const model = await this.getSelectedModel();
    logger.debug("Using model from auth.json", { model });

    const requestBody = {
      messages: request.messages,
      model, // Include model from auth.json
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: false,
    };

    const response = await this.makeRequest(
      "/v1/chat/completions",
      requestBody,
      false
    );
    const data = await response.json();

    console.log("this is the data in cloud proxy", data);

    // Handle OpenAI-style response format
    if (data.choices && data.choices.length > 0) {
      const choice = data.choices[0];
      const content = choice.message?.content || choice.text || "";

      return {
        content,
        model,
        finishReason:
          choice.finish_reason === "stop"
            ? "stop"
            : choice.finish_reason === "length"
              ? "length"
              : "stop",
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    }

    // Handle Anthropic-style response format
    if (data.content) {
      const textContent = Array.isArray(data.content)
        ? data.content.find((c: any) => c.type === "text")?.text || ""
        : data.content;

      return {
        content: textContent,
        model,
        finishReason: data.stop_reason === "end_turn" ? "stop" : "stop",
        usage: {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens:
            (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
      };
    }

    throw new Error("Unexpected response format from cloud proxy");
  }

  override async *generateStream(
    request: LLMGenerateOptions
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    logger.debug("Sending streaming request to cloud proxy...");

    // Get model from auth.json (~/.driftal/auth.json)
    const model = await this.getSelectedModel();
    logger.debug("Using model from auth.json for streaming", { model });

    const requestBody = {
      messages: request.messages,
      model, // Include model from auth.json
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true, // Enable streaming!
      // Pass through reasoning effort if provided in the request
      ...(request.reasoningEffort && {
        reasoning_effort: request.reasoningEffort,
      }),
    };

    logger.debug("Streaming request body:", {
      model,
      hasReasoningEffort: !!request.reasoningEffort,
    });

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

                // Handle reasoning/thinking content from reasoning models
                if (delta?.reasoning) {
                  yield {
                    type: "reasoning_delta",
                    delta: delta.reasoning,
                  };
                }

                // Handle regular content
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
                  delta: "", // Required by LLMStreamChunk interface
                  done: true,
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
