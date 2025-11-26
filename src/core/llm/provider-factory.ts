import type { LLMConfig } from "../../config/schema.js";
import { LLMProvider } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenRouterProvider } from "./providers/openrouter.js";
import { CloudProxyProvider } from "./providers/cloud-proxy.js";
import { logger } from "../../utils/logger.js";

export class ProviderFactory {
  private static providers: Map<string, LLMProvider> = new Map();

  /**
   * Get or create a provider instance
   */
  static getProvider(config: LLMConfig, providerName?: string): LLMProvider {
    const name = providerName || config.providers.provider;
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
  private static createProvider(
    config: LLMConfig,
    providerName: string
  ): LLMProvider {
    switch (providerName) {
      case "cloud-proxy":
        if (
          !config.providers.cloudProxy ||
          !config.providers.cloudProxy.enabled
        ) {
          throw new Error(
            "Cloud proxy not configured. Please run 'driftal login' to authenticate."
          );
        }
        return new CloudProxyProvider({
          proxyUrl: config.providers.cloudProxy.proxyUrl,
        });
      case "anthropic":
        return new AnthropicProvider(config);
      case "openai":
        return new OpenAIProvider(config);
      case "gemini":
        return new GeminiProvider(config);
      case "ollama":
        return new OllamaProvider(config);
      case "openrouter":
        return new OpenRouterProvider(config);
      default:
        throw new Error(`Unknown provider: ${providerName}`);
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
    if (config.providers.gemini) {
      available.push("gemini");
    }
    if (config.providers.ollama) {
      available.push("ollama");
    }
    if (config.providers.openrouter) {
      available.push("openrouter");
    }

    return available;
  }
}
