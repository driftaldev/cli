import type { LLMConfig } from "../config/schema.js";
import { createSecurityAgent } from "./agents/security-agent.js";
import { createPerformanceAgent } from "./agents/performance-agent.js";
import { createLogicAgent } from "./agents/logic-agent.js";
import { createReviewWorkflow } from "./workflows/review-workflow.js";
import { ReviewMemory } from "./memory/review-memory.js";
import { codeAnalysisTools } from "./tools/code-analysis-tools.js";
import { gitTools } from "./tools/git-tools.js";
import { loadAuthTokens } from "../utils/token-manager.js";
import type { AgentModelConfig } from "./types.js";
import type { Stack } from "../core/indexer/stack-detector.js";
import packageJson from "../../package.json" assert { type: "json" };

const DEFAULT_PROXY_URL =
  process.env.SCOUT_PROXY_URL || "https://auth.driftal.dev/v1";
const CLI_VERSION = packageJson.version ?? "dev";

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

  private async resolveAgentModelConfig(): Promise<AgentModelConfig> {
    const llmConfig = this.config.llmConfig;
    const primary = llmConfig.providers.primary;

    switch (primary) {
      case "cloud-proxy": {
        const tokens = await loadAuthTokens();
        if (!tokens?.accessToken) {
          throw new Error(
            "Not authenticated with cloud proxy. Please run 'driftal login'."
          );
        }

        const proxyUrl =
          llmConfig.providers.cloudProxy?.proxyUrl || DEFAULT_PROXY_URL;
        const selectedModel =
          tokens.selectedModels?.primary || "openai/gpt-4-turbo";
        const { providerId, modelId } =
          this.parseModelIdentifier(selectedModel);

        return {
          id: `${providerId}/${modelId}`,
          url: proxyUrl,
          apiKey: tokens.accessToken,
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "X-Driftal-CLI-Version": `driftal/${CLI_VERSION}`,
          },
        };
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

  private parseModelIdentifier(modelId: string): {
    providerId: string;
    modelId: string;
  } {
    if (!modelId.includes("/")) {
      if (modelId.startsWith("claude")) {
        return { providerId: "anthropic", modelId };
      }
      if (modelId.startsWith("gpt-")) {
        return { providerId: "openai", modelId };
      }
      return { providerId: "openai", modelId };
    }

    const [providerId, ...rest] = modelId.split("/");
    const normalizedModelId = rest.join("/");
    return {
      providerId: providerId || "openai",
      modelId: normalizedModelId || modelId,
    };
  }

  /**
   * Get the review memory instance
   */
  getMemory(): ReviewMemory {
    return this.memory;
  }

  /**
   * Get all available tools
   */
  getTools() {
    return {
      ...codeAnalysisTools,
      ...gitTools,
    };
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
