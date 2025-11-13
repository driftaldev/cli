import type { LLMConfig } from "../../config/schema.js";
import { LLMProvider } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { OllamaProvider } from "./providers/ollama.js";
import { CloudProxyProvider } from "./providers/cloud-proxy.js";
import { logger } from "../../utils/logger.js";

export class ProviderFactory {
  private static providers: Map<string, LLMProvider> = new Map();

  /**
   * Get or create a provider instance
   */
  static getProvider(config: LLMConfig, providerName?: string): LLMProvider {
    const name = providerName || config.providers.primary;
    const cacheKey = `${name}`;

    // Return cached provider if exists
    if (this.providers.has(cacheKey)) {
      return this.providers.get(cacheKey)!;
    }

    // Create new provider
    const provider = this.createProvider(config, name);
    this.providers.set(cacheKey, provider);

    return provider;
  }

  /**
   * Create a new provider instance
   */
  private static createProvider(config: LLMConfig, providerName: string): LLMProvider {
    switch (providerName) {
      case "cloud-proxy":
        if (!config.providers.cloudProxy || !config.providers.cloudProxy.enabled) {
          throw new Error(
            "Cloud proxy not configured. Please run 'scoutcli login' to authenticate."
          );
        }
        return new CloudProxyProvider({
          proxyUrl: config.providers.cloudProxy.proxyUrl
        });
      case "anthropic":
        return new AnthropicProvider(config);
      case "openai":
        return new OpenAIProvider(config);
      case "ollama":
        return new OllamaProvider(config);
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  /**
   * Get provider with fallback chain
   */
  static async getProviderWithFallback(config: LLMConfig): Promise<LLMProvider> {
    const primaryProvider = config.providers.primary;

    try {
      const provider = this.getProvider(config, primaryProvider);
      // Test if provider is available
      await this.testProvider(provider);
      return provider;
    } catch (error) {
      logger.warn(`Primary provider ${primaryProvider} failed:`, error);

      // Try fallback if configured
      if (config.providers.fallback) {
        try {
          const fallbackProvider = this.getProvider(config, config.providers.fallback);
          await this.testProvider(fallbackProvider);
          logger.info(`Using fallback provider: ${config.providers.fallback}`);
          return fallbackProvider;
        } catch (fallbackError) {
          logger.error(`Fallback provider ${config.providers.fallback} failed:`, fallbackError);
        }
      }

      throw new Error(`All providers failed. Last error: ${error}`);
    }
  }

  /**
   * Test if a provider is available
   */
  private static async testProvider(provider: LLMProvider): Promise<void> {
    // Simple test to check if provider is accessible
    // This could be expanded to do a health check API call
    if (!provider) {
      throw new Error("Provider not initialized");
    }
  }

  /**
   * Clear cached providers
   */
  static clearCache(): void {
    this.providers.clear();
  }

  /**
   * Get all available provider names from config
   */
  static getAvailableProviders(config: LLMConfig): string[] {
    const available: string[] = [];

    if (config.providers.cloudProxy?.enabled) {
      available.push("cloud-proxy");
    }
    if (config.providers.anthropic) {
      available.push("anthropic");
    }
    if (config.providers.openai) {
      available.push("openai");
    }
    if (config.providers.ollama) {
      available.push("ollama");
    }

    return available;
  }
}
