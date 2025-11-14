import type { GitDiff } from "../../utils/git.js";
import type { LLMConfig, ReviewConfig } from "../../config/schema.js";
import type { ReviewContext } from "../llm/prompts/review-templates.js";
import { type ReviewResults, IssueRanker } from "./issue.js";
import { ChangeAnalyzer } from "./change-analyzer.js";
import { MastraReviewOrchestrator, createMastraOrchestrator } from "../../mastra/index.js";
import { ContextEnricher } from "./context-enricher.js";
import { loadSavedRepoName } from "../../utils/repo-name-store.js";
import { detectStacks } from "../indexer/stack-detector.js";
import { logger } from "../../utils/logger.js";

export interface ReviewOptions {
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  analyzers?: string[];
  quick?: boolean;
  verbose?: boolean;
}

export class CodeReviewer {
  private issueRanker: IssueRanker;
  private changeAnalyzer: ChangeAnalyzer;
  private reviewConfig: ReviewConfig;
  private llmConfig: LLMConfig;
  private mastraOrchestrator?: MastraReviewOrchestrator;
  private mastraInitialized: boolean = false;
  private contextEnricher?: ContextEnricher;

  constructor(llmConfig: LLMConfig, reviewConfig: ReviewConfig) {
    this.llmConfig = llmConfig;
    this.issueRanker = new IssueRanker();
    this.changeAnalyzer = new ChangeAnalyzer();
    this.reviewConfig = reviewConfig;
  }

  /**
   * Initialize Mastra orchestrator
   */
  private async initializeMastra(): Promise<void> {
    if (this.mastraInitialized) return;

    try {
      // Detect stacks in the current repository
      const repoPath = process.cwd();
      const stacks = await detectStacks(repoPath);

      this.mastraOrchestrator = await createMastraOrchestrator({
        llmConfig: this.llmConfig,
        memory: this.reviewConfig.mastra?.memory,
        stacks
      });
      this.mastraInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize Mastra:', error);
      throw new Error('Mastra initialization failed. Cannot proceed with review.');
    }
  }

  /**
   * Review code changes using Mastra orchestration
   */
  async review(
    diff: GitDiff,
    context: ReviewContext | null,
    options: ReviewOptions = {},
    onProgress?: (current: number, total: number, fileName: string) => void
  ): Promise<ReviewResults> {
    const startTime = Date.now();

    // Initialize Mastra
    await this.initializeMastra();

    if (!this.mastraOrchestrator) {
      throw new Error('Failed to initialize Mastra orchestrator');
    }

    // Initialize context enricher
    const repoPath = process.cwd();
    const repoName = await loadSavedRepoName(repoPath);

    if (!this.contextEnricher && repoName) {
      this.contextEnricher = new ContextEnricher({
        repoPath,
        repoName,
        maxSimilarPatterns: 5,
        maxImportDepth: 2,
        includeTests: true,
      });
    }

    // Run the Mastra workflow with context enricher
    const run = await this.mastraOrchestrator.reviewWorkflow.createRunAsync();
    const execution = await run.start({
      inputData: {
        diff,
        changeAnalyzer: this.changeAnalyzer,
        securityAgent: this.mastraOrchestrator.securityAgent,
        performanceAgent: this.mastraOrchestrator.performanceAgent,
        logicAgent: this.mastraOrchestrator.logicAgent,
        issueRanker: this.issueRanker,
        contextEnricher: this.contextEnricher,
        repoPath,
        repoName,
        onProgress,
        options: {
          minConfidence: 0.5,
          severityFilter: options.severity
        }
      }
    });

    if (execution.status !== 'success' || !execution.result) {
      throw new Error('Mastra review workflow did not complete successfully');
    }

    const workflowResult = execution.result;

    let analysis = workflowResult.analysis;
    if (!analysis) {
      try {
        analysis = await this.changeAnalyzer.analyze(diff);
      } catch {
        analysis = {
          type: 'unknown',
          complexity: 'unknown',
          riskScore: 0,
          affectedModules: [],
          testCoverage: false,
          breakingChange: false,
          filesChanged: diff.files.length,
          linesAdded: diff.stats.additions,
          linesRemoved: diff.stats.deletions
        } as any;
      }
    }

    const issues = workflowResult.rankedIssues ?? [];

    const duration = Date.now() - startTime;

    // Calculate lines of code reviewed
    // For git diff: additions + deletions gives total lines changed
    const linesOfCodeReviewed = diff.stats.additions + diff.stats.deletions;

    // Get total tokens from workflow result (if available)
    // The Mastra workflow may aggregate token usage from all LLM calls
    const totalTokens = workflowResult.totalTokens ?? 0;

    // Get model from config
    const model = this.llmConfig.model || 'claude-3-5-sonnet-20241022';

    const results: ReviewResults = {
      issues,
      filesReviewed: diff.files.length,
      timestamp: Date.now(),
      duration,
      analysis: {
        type: (analysis as any).type ?? 'unknown',
        complexity: (analysis as any).complexity ?? 'unknown',
        riskScore: (analysis as any).riskScore ?? 0,
        affectedModules: (analysis as any).affectedModules ?? [],
        testCoverage: (analysis as any).testCoverage ?? false,
        breakingChange: (analysis as any).breakingChange ?? false,
        filesChanged: (analysis as any).filesChanged ?? diff.files.length,
        linesAdded: (analysis as any).linesAdded ?? diff.stats.additions,
        linesRemoved: (analysis as any).linesRemoved ?? diff.stats.deletions
      },
      // Metadata for backend logging
      totalTokens,
      linesOfCodeReviewed,
      model,
      repositoryName: repoName || undefined
    };

    // Store in memory if enabled
    if (this.reviewConfig.memory?.enabled && this.reviewConfig.memory.learnFromFeedback) {
      const memory = this.mastraOrchestrator.getMemory();
      await memory.storeReview(results, process.cwd(), diff.files[0]?.path || 'unknown');
    }

    return results;
  }

  /**
   * Get Mastra memory instance (if enabled)
   */
  getMemory() {
    return this.mastraOrchestrator?.getMemory();
  }

}
