import type { LLMConfig } from "../config/schema.js";
import { createSecurityAgent } from "./agents/security-agent.js";
import { createPerformanceAgent } from "./agents/performance-agent.js";
import { createLogicAgent } from "./agents/logic-agent.js";
import { createReviewWorkflow } from "./workflows/review-workflow.js";
import { ReviewMemory } from "./memory/review-memory.js";
import type { AgentModelConfig } from "./types.js";
import type { Stack } from "../core/indexer/stack-detector.js";
import { QueryRouter } from "../core/query/query-router.js";
import { MossClient } from "../core/indexer/moss-client.js";
import { logger } from "../utils/logger.js";

export interface MastraConfig {
  llmConfig: LLMConfig;
  memory?: {
    enabled?: boolean;
    storageDir?: string;
  };
  stacks?: Stack[];
}

/**
 * Initialize Mastra instance for code review
 */
export class MastraReviewOrchestrator {
  private config: MastraConfig;
  private memory: ReviewMemory;
  private initialized: boolean = false;
  private modelConfig?: AgentModelConfig;
  private _queryRouter?: QueryRouter;

  // Agents
  public securityAgent: any;
  public performanceAgent: any;
  public logicAgent: any;

  // Workflow
  public reviewWorkflow: any;

  constructor(config: MastraConfig) {
    this.config = config;

    const memoryEnabled = config.memory?.enabled ?? true;
    const memoryDir = config.memory?.storageDir ?? ".driftal/memory";
    this.memory = new ReviewMemory(memoryDir, memoryEnabled);
  }

  /**
   * Initialize all agents and workflows
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize memory
    await this.memory.initialize();

    // Resolve model configuration for agents
    this.modelConfig = await this.resolveAgentModelConfig();

    // Initialize QueryRouter for search_code tool
    await this.initializeQueryRouter();

    // Get stacks from config
    const stacks = this.config.stacks;

    // Create agents with stack-specific prompts
    this.securityAgent = createSecurityAgent(this.modelConfig, stacks);
    this.performanceAgent = createPerformanceAgent(this.modelConfig, stacks);
    this.logicAgent = createLogicAgent(this.modelConfig, stacks);

    // Create workflow
    this.reviewWorkflow = createReviewWorkflow();

    this.initialized = true;
  }

  /**
   * Initialize QueryRouter for code search
   */
  private async initializeQueryRouter(): Promise<void> {
    try {
      // Load config to get MOSS credentials
      const { loadConfig } = await import("../config/loader.js");
      const config = await loadConfig();

      // Create MossClient
      const mossClient = new MossClient(
        config.moss.project_id,
        config.moss.project_key,
        config.moss.index_directory
      );

      // Create QueryRouter
      this._queryRouter = new QueryRouter(mossClient);
    } catch (error) {
      // Log warning but don't fail initialization
      // The search tool will gracefully handle missing QueryRouter
      console.warn(
        "Failed to initialize QueryRouter for search_code tool:",
        error
      );
    }
  }

  private async resolveAgentModelConfig(): Promise<AgentModelConfig> {
    const llmConfig = this.config.llmConfig;
    const primary = llmConfig.providers.primary;

    switch (primary) {
      case "cloud-proxy": {
        // Import the new cloud proxy SDK provider
        const { getCloudProxyModel } = await import(
          "./providers/cloud-proxy-sdk.js"
        );

        // Return a LanguageModelV2 instance directly
        // This ensures Mastra calls CloudProxyProvider instead of making direct HTTP requests
        return await getCloudProxyModel();
      }
      case "anthropic": {
        const model =
          llmConfig.providers.anthropic?.model || "claude-3-5-sonnet-20241022";
        return `anthropic/${model}`;
      }
      case "openai": {
        const model = llmConfig.providers.openai?.model || "gpt-4-turbo";
        return `openai/${model}`;
      }
      case "ollama": {
        const baseUrl =
          llmConfig.providers.ollama?.baseUrl || "http://localhost:11434";
        const model = llmConfig.providers.ollama?.model || "codellama";
        return {
          id: `ollama/${model}`,
          url: baseUrl,
        };
      }
      default:
        throw new Error(
          `Unsupported primary provider '${primary}' for Mastra integration.`
        );
    }
  }

  /**
   * Get the review memory instance
   */
  getMemory(): ReviewMemory {
    return this.memory;
  }

  /**
   * Get QueryRouter for code search
   */
  getQueryRouter(): QueryRouter | undefined {
    return this._queryRouter;
  }

  /**
   * Get model config for agents
   */
  getModelConfig() {
    return this.modelConfig;
  }

  /**
   * Get stacks for agents
   */
  getStacks() {
    return this.config.stacks;
  }

  /**
   * Get all available tools
   */
  getTools() {
    return {};
  }
}

/**
 * Create and initialize Mastra orchestrator
 */
export async function createMastraOrchestrator(
  config: MastraConfig
): Promise<MastraReviewOrchestrator> {
  const orchestrator = new MastraReviewOrchestrator(config);
  await orchestrator.initialize();
  return orchestrator;
}

export { ReviewMemory } from "./memory/review-memory.js";
