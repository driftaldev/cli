import type { LLMProvider } from "../../core/llm/provider.js";
import type { LLMConfig } from "../../config/schema.js";
import { ProviderFactory } from "../../core/llm/provider-factory.js";

/**
 * Adapter to bridge Mastra with existing LLM providers
 * This allows Mastra agents to use our existing OpenAI/Anthropic/Ollama setup
 */
export class MastraProviderAdapter {
  private provider: LLMProvider;

  constructor(config: LLMConfig, providerName?: string) {
    this.provider = ProviderFactory.getProvider(config, providerName);
  }

  /**
   * Generate completion (compatible with Mastra's expected format)
   */
  async generate(params: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ content: string; usage?: { total: number } }> {
    const response = await this.provider.generate({
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens
    });

    return {
      content: response.content,
      usage: response.usage ? { total: response.usage.total } : undefined
    };
  }

  /**
   * Stream completion (for real-time feedback)
   */
  async *stream(params: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
  }): AsyncGenerator<string> {
    const response = await this.provider.generate({
      messages: params.messages,
      temperature: params.temperature
    });

    // For now, yield the full response
    // TODO: Implement actual streaming when providers support it
    yield response.content;
  }

  /**
   * Get the underlying provider instance
   */
  getProvider(): LLMProvider {
    return this.provider;
  }
}
