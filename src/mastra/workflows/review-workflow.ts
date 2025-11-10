import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import type { Agent } from "@mastra/core";
import type { GitDiff, DiffFile } from "../../utils/git.js";
import type { ChangeAnalysis } from "../../core/review/change-analyzer.js";
import type { ReviewIssue } from "../../core/review/issue.js";
import { logger } from "../../utils/logger.js";
import { ContextEnricher } from "../../core/review/context-enricher.js";
import {
  ContextStrategyFactory,
  type EnrichedContext,
} from "../../core/review/context-strategies.js";
import { RelevanceRanker } from "../../core/review/relevance-ranker.js";
import { runSecurityAnalysisWithContext } from "../agents/security-agent.js";
import { runPerformanceAnalysisWithContext } from "../agents/performance-agent.js";
import { runLogicAnalysisWithContext } from "../agents/logic-agent.js";
import { promises as fs } from "fs";
import path from "path";

/**
 * Utility function to log context to .scout-code folder
 */
async function logContextToFile(
  filePath: string,
  agentName: string,
  context: any
): Promise<void> {
  try {
    // Get the working directory (where CLI is run from)
    const workingDir = process.cwd();
    const scoutCodeDir = path.join(workingDir, ".scout-code");

    // Ensure .scout-code directory exists
    await fs.mkdir(scoutCodeDir, { recursive: true });

    // Create filename: <filename>_<agentName>_<timestamp>.txt
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseFileName = path.basename(filePath).replace(/\//g, "_");
    const logFileName = `${baseFileName}_${agentName}_${timestamp}.txt`;
    const logFilePath = path.join(scoutCodeDir, logFileName);

    // Format the context for logging
    const logContent = `
================================================================================
CONTEXT LOG FOR FILE: ${filePath}
AGENT: ${agentName}
TIMESTAMP: ${new Date().toISOString()}
================================================================================

FILE NAME: ${context.fileName || "N/A"}
LANGUAGE: ${context.language || "N/A"}

================================================================================
CHANGED CODE:
================================================================================
${context.changedCode || "N/A"}

================================================================================
FULL FILE CONTENT:
================================================================================
${context.fullContent || "N/A"}

================================================================================
IMPORTS (${context.imports?.length || 0}):
================================================================================
${context.imports ? JSON.stringify(context.imports, null, 2) : "None"}

================================================================================
TYPE DEFINITIONS (${context.typeDefinitions?.length || 0}):
================================================================================
${context.typeDefinitions ? JSON.stringify(context.typeDefinitions, null, 2) : "None"}

================================================================================
SIMILAR PATTERNS (${context.similarPatterns?.length || 0}):
================================================================================
${context.similarPatterns ? JSON.stringify(context.similarPatterns, null, 2) : "None"}

================================================================================
DEPENDENCIES - UPSTREAM (${context.dependencies?.upstream?.length || 0}):
================================================================================
${context.dependencies?.upstream ? JSON.stringify(context.dependencies.upstream, null, 2) : "None"}

================================================================================
DEPENDENCIES - DOWNSTREAM (${context.dependencies?.downstream?.length || 0}):
================================================================================
${context.dependencies?.downstream ? JSON.stringify(context.dependencies.downstream, null, 2) : "None"}

================================================================================
RELATED TESTS (${context.relatedTests?.length || 0}):
================================================================================
${context.relatedTests ? JSON.stringify(context.relatedTests, null, 2) : "None"}

================================================================================
END OF CONTEXT LOG
================================================================================
`;

    // Write to file
    await fs.writeFile(logFilePath, logContent, "utf-8");
    logger.debug(`[ContextLogger] Context logged to: ${logFilePath}`);
  } catch (error) {
    logger.error(`[ContextLogger] Failed to log context: ${error}`);
  }
}

/**
 * Step 1: Analyze changes to understand complexity and risk
 */
export const analyzeChangesStep = createStep({
  id: "analyze-changes",
  inputSchema: z.object({
    diff: z.any().describe("Git diff object"),
    changeAnalyzer: z.any().describe("Change analyzer instance"),
  }),
  outputSchema: z.object({
    analysis: z.any().describe("Change analysis result"),
    diff: z.any(),
  }),
  execute: async ({ inputData }) => {
    const { diff, changeAnalyzer } = inputData;
    const analysis = await changeAnalyzer.analyze(diff);

    return {
      ...inputData,
      analysis,
    };
  },
});

/**
 * Step 2: Gather context for review
 * Now enriches each file with comprehensive codebase context
 */
export const gatherContextStep = createStep({
  id: "gather-context",
  inputSchema: z.object({
    analysis: z.any(),
    diff: z.any(),
    contextEnricher: z.any().optional(),
    repoPath: z.string().optional(),
    repoName: z.string().optional(),
  }),
  outputSchema: z.object({
    reviewableFiles: z.array(z.any()),
    enrichedContexts: z.record(z.any()),
    analysis: z.any(),
  }),
  execute: async ({ inputData }) => {
    const { diff, analysis, contextEnricher, repoPath, repoName } = inputData;

    // Filter files that should be reviewed
    const reviewableFiles = diff.files.filter((file: DiffFile) => {
      if (file.status === "deleted") return false;

      const nonReviewableExtensions = [
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".ico",
        ".pdf",
        ".zip",
        ".tar",
        ".gz",
        ".lock",
        ".min.js",
        ".bundle.js",
      ];

      const lowerPath = file.path.toLowerCase();
      if (nonReviewableExtensions.some((ext) => lowerPath.endsWith(ext))) {
        return false;
      }

      const codeExtensions = [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".py",
        ".rb",
        ".go",
        ".rs",
        ".java",
        ".cpp",
        ".c",
        ".cs",
        ".php",
        ".swift",
        ".kt",
      ];

      return codeExtensions.some((ext) => lowerPath.endsWith(ext));
    });

    // Enrich context for each reviewable file
    const enrichedContexts: Record<string, EnrichedContext> = {};

    if (contextEnricher && repoPath) {
      logger.info(
        `[Workflow:GatherContext] Starting enrichment for ${reviewableFiles.length} files`
      );
      const enrichStartTime = Date.now();

      for (let i = 0; i < reviewableFiles.length; i++) {
        const file = reviewableFiles[i];
        try {
          logger.debug(
            `[Workflow:GatherContext] Enriching ${i + 1}/${
              reviewableFiles.length
            }: ${file.path}`
          );
          const changedCode = extractChangedCode(file);
          const fullFilePath = `${repoPath}/${file.path}`;

          const enrichedContext = await contextEnricher.enrich({
            fileName: file.path,
            changedCode,
            language: file.language || "typescript",
            fullFilePath,
          });

          enrichedContexts[file.path] = enrichedContext;
          logger.debug(`[Workflow:GatherContext] ✓ Enriched ${file.path}`);
        } catch (error) {
          logger.warn(
            `[Workflow:GatherContext] ✗ Failed to enrich ${file.path}:`,
            error
          );
          // Continue with other files
        }
      }

      const enrichDuration = Date.now() - enrichStartTime;
      logger.info(
        `[Workflow:GatherContext] Context enrichment complete: ` +
          `${Object.keys(enrichedContexts).length}/${
            reviewableFiles.length
          } files enriched in ${enrichDuration}ms`
      );
    } else {
      logger.warn(
        "[Workflow:GatherContext] Context enricher not provided, skipping enrichment"
      );
    }

    return {
      ...inputData,
      reviewableFiles,
      enrichedContexts,
      analysis,
    };
  },
});

/**
 * Step 3: Run all three agents in parallel with enriched context
 */
export const runAllAgentsInParallelStep = createStep({
  id: "run-all-agents-parallel",
  inputSchema: z.object({
    reviewableFiles: z.array(z.any()),
    enrichedContexts: z.record(z.any()).optional(),
    securityAgent: z.any(),
    performanceAgent: z.any(),
    logicAgent: z.any(),
    onProgress: z.function().optional(),
    analysis: z.any().optional(),
  }),
  outputSchema: z.object({
    securityIssues: z.array(z.any()),
    performanceIssues: z.array(z.any()),
    logicIssues: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const {
      reviewableFiles,
      enrichedContexts,
      securityAgent,
      performanceAgent,
      logicAgent,
      onProgress,
    } = inputData;

    // Helper function to run an agent on all files
    const runAgentOnFiles = async (
      agent: any,
      agentName: string,
      strategyType: "security" | "performance" | "logic",
      analysisFn: (agent: any, context: any) => Promise<ReviewIssue[]>
    ): Promise<ReviewIssue[]> => {
      const issues: ReviewIssue[] = [];
      const ranker = new RelevanceRanker();
      const strategy = ContextStrategyFactory.getStrategy(strategyType);

      for (let i = 0; i < reviewableFiles.length; i++) {
        const file = reviewableFiles[i];

        if (onProgress) {
          // Update progress with agent name prefix to show parallel execution
          onProgress(
            i + 1,
            reviewableFiles.length,
            `${agentName}:${file.path}`
          );
        }

        const changedCode = extractChangedCode(file);
        if (!changedCode) continue;

        // Get enriched context if available
        let context: any;
        if (enrichedContexts && enrichedContexts[file.path]) {
          const fullContext = enrichedContexts[file.path];
          logger.debug(
            `[${agentName}:${file.path}] Full context: ` +
              `${fullContext.imports?.length || 0} imports, ` +
              `${fullContext.typeDefinitions?.length || 0} types, ` +
              `${fullContext.similarPatterns?.length || 0} patterns`
          );
          context = strategy.selectContext(fullContext, ranker);
          logger.debug(
            `[${agentName}:${file.path}] Selected context: ` +
              `${context.imports?.length || 0} imports, ` +
              `${context.typeDefinitions?.length || 0} types, ` +
              `${context.similarPatterns?.length || 0} patterns`
          );
        } else {
          logger.debug(
            `[${agentName}:${file.path}] No enriched context, using basic context`
          );
          context = {
            changedCode,
            fileName: file.path,
            language: file.language,
          };
        }

        // Log the context being passed to the agent
        await logContextToFile(file.path, agentName, context);

        // Run the agent-specific analysis function
        const fileIssues = await analysisFn(agent, context);

        issues.push(...fileIssues);
      }

      logger.debug(
        `[Workflow] ${agentName} agent found ${issues.length} issues`
      );
      return issues;
    };

    // Run all three agents in parallel
    logger.info("[Workflow] Starting parallel execution of all agents");
    const startTime = Date.now();

    const [securityIssues, performanceIssues, logicIssues] = await Promise.all([
      runAgentOnFiles(
        securityAgent,
        "Security",
        "security",
        runSecurityAnalysisWithContext
      ),
      runAgentOnFiles(
        performanceAgent,
        "Performance",
        "performance",
        runPerformanceAnalysisWithContext
      ),
      runAgentOnFiles(
        logicAgent,
        "Logic",
        "logic",
        runLogicAnalysisWithContext
      ),
    ]);

    const duration = Date.now() - startTime;
    logger.info(
      `[Workflow] Parallel agent execution complete in ${duration}ms: ` +
        `Security: ${securityIssues.length} issues, ` +
        `Performance: ${performanceIssues.length} issues, ` +
        `Logic: ${logicIssues.length} issues`
    );

    return {
      ...inputData,
      securityIssues,
      performanceIssues,
      logicIssues,
    };
  },
});

/**
 * Step 6: Synthesize results from all agents
 */
export const synthesizeResultsStep = createStep({
  id: "synthesize-results",
  inputSchema: z.object({
    securityIssues: z.array(z.any()).optional(),
    performanceIssues: z.array(z.any()).optional(),
    logicIssues: z.array(z.any()).optional(),
  }),
  outputSchema: z.object({
    allIssues: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const securityIssues = inputData.securityIssues ?? [];
    const performanceIssues = inputData.performanceIssues ?? [];
    const logicIssues = inputData.logicIssues ?? [];

    logger.debug("[Workflow] Synthesize step received:");
    logger.debug("  Security issues:", securityIssues.length);
    logger.debug("  Performance issues:", performanceIssues.length);
    logger.debug("  Logic issues:", logicIssues.length);

    // Combine all issues
    const allIssues = [...securityIssues, ...performanceIssues, ...logicIssues];

    logger.debug("[Workflow] Total combined issues:", allIssues.length);

    return {
      ...inputData,
      allIssues,
    };
  },
});

/**
 * Step 7: Rank and filter issues
 */
export const rankIssuesStep = createStep({
  id: "rank-issues",
  inputSchema: z.object({
    allIssues: z.array(z.any()).optional(),
    issueRanker: z.any().optional(),
    minConfidence: z.number().optional(),
    severityFilter: z.string().optional(),
    options: z
      .object({
        minConfidence: z.number().default(0.5),
        severityFilter: z.string().optional(),
      })
      .optional(),
  }),
  outputSchema: z.object({
    rankedIssues: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const allIssues = inputData.allIssues ?? [];
    const issueRanker = inputData.issueRanker;
    const minConfidence =
      inputData.minConfidence ?? inputData.options?.minConfidence ?? 0.5;
    const severityFilter =
      inputData.severityFilter ?? inputData.options?.severityFilter;

    logger.debug("[Workflow] Rank step received", allIssues.length, "issues");
    logger.debug("[Workflow] Min confidence:", minConfidence);
    logger.debug("[Workflow] Severity filter:", severityFilter);

    if (!issueRanker) {
      logger.debug("[Workflow] No issue ranker, returning all issues");
      return {
        ...inputData,
        rankedIssues: allIssues,
      };
    }

    // Deduplicate
    let issues = issueRanker.deduplicate(allIssues);
    logger.debug("[Workflow] After deduplication:", issues.length, "issues");

    // Rank by importance
    issues = issueRanker.rank(issues);
    logger.debug("[Workflow] After ranking:", issues.length, "issues");

    // Filter by confidence
    issues = issueRanker.filterByConfidence(issues, minConfidence);
    logger.debug(
      "[Workflow] After confidence filter:",
      issues.length,
      "issues"
    );

    // Filter by severity if specified
    if (severityFilter) {
      issues = issueRanker.filter(issues, severityFilter);
      logger.debug(
        "[Workflow] After severity filter:",
        issues.length,
        "issues"
      );
    }

    logger.debug("[Workflow] Final ranked issues:", issues.length);

    return {
      ...inputData,
      rankedIssues: issues,
    };
  },
});

/**
 * Helper: Extract changed code from diff file
 */
function extractChangedCode(file: DiffFile): string {
  const lines: string[] = [];

  for (const chunk of file.chunks) {
    if (chunk.header) {
      lines.push(`// ${chunk.header}`);
    }

    for (const line of chunk.lines) {
      if (line.type === "context" || line.type === "added") {
        lines.push(line.content);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Create the complete review workflow with context enrichment
 */
export function createReviewWorkflow() {
  return createWorkflow({
    name: "code-review-workflow",
    triggerSchema: z.object({
      diff: z.any(),
      changeAnalyzer: z.any(),
      securityAgent: z.any(),
      performanceAgent: z.any(),
      logicAgent: z.any(),
      issueRanker: z.any(),
      contextEnricher: z.any().optional(),
      repoPath: z.string().optional(),
      repoName: z.string().optional(),
      onProgress: z.function().optional(),
      options: z
        .object({
          minConfidence: z.number().default(0.5),
          severityFilter: z.string().optional(),
        })
        .optional(),
    }),
  })
    .then(analyzeChangesStep)
    .then(gatherContextStep)
    .then(runAllAgentsInParallelStep)
    .then(synthesizeResultsStep)
    .then(rankIssuesStep)
    .commit();
}
