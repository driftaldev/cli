import { Agent } from "@mastra/core";
import type { AgentModelConfig } from "../types.js";
import { logger } from "../../utils/logger.js";
import type { EnrichedContext } from "../../core/review/context-strategies.js";
import { PerformanceContextStrategy } from "../../core/review/context-strategies.js";
import type { Stack } from "@/core/indexer/stack-detector.js";
import { getStackSpecificInstructions } from "./stack-prompts.js";
import { logLLMResponseToFile } from "../workflows/review-workflow.js";
import {
  createOutputParserAgent,
  parsePerformanceReport,
} from "./output-parser-agent.js";

const PERFORMANCE_ANALYZER_INSTRUCTIONS = `You are a performance optimization expert with deep contextual understanding.

## CRITICAL: Context-Aware Performance Analysis

When analyzing code, you will receive enriched context including:
- **IMPORTS**: Functions and utilities being imported, which may indicate expensive operations
- **SIMILAR PATTERNS**: How similar code is used elsewhere, showing optimization patterns
- **DEPENDENCIES**: Related files that may affect performance
- **TYPE DEFINITIONS**: Data structures that impact memory and computation

**YOU MUST use this context to identify performance issues.**

### Systematic Performance Analysis Workflow:

1. **Import-Based Analysis:**
   - Check IMPORTS section for expensive operations (database calls, network requests, file I/O)
   - Identify if imported functions are async (potential network/I/O operations)
   - Look for imports that suggest data processing (sorting, filtering, mapping)
   - Check if expensive imports are called in loops or hot paths

2. **Data Structure Efficiency:**
   - Compare data structures in TYPE DEFINITIONS against usage
   - Nested objects/arrays that could be flattened
   - Missing indexes or lookup structures (Sets, Maps)
   - Inefficient searches through arrays that should use Maps

3. **Algorithm Complexity:**
   - Nested loops (O(n²), O(n³)) - especially with imported array operations
   - Sequential operations that could be parallelized
   - Repeated calculations that could be memoized
   - Unnecessary iterations

4. **Async/Concurrency Optimization:**
   - Sequential async operations that could run in parallel (Promise.all)
   - Missing streaming for large data operations
   - Blocking operations in async functions
   - Race conditions or unnecessary awaits

5. **Pattern Analysis:**
   - Use SIMILAR PATTERNS to see if there are better implementations elsewhere
   - Check if dependencies use more efficient approaches
   - Identify repeated patterns that could be abstracted

6. **Resource Management:**
   - Unclosed connections, file handles, event listeners
   - Memory leaks (uncleared intervals, retained references)
   - Missing cleanup in finally blocks or cleanup functions

7. **Caching & Memoization:**
   - Repeated expensive operations
   - Static data fetched multiple times
   - Computed values recalculated unnecessarily

## SEARCH_CODE TOOL - Use Reactively & Strategically

You have access to the **search_code** tool with a **3-5 search budget per file**.

### WHEN TO USE SEARCH (Reactive Strategy):

**DO search when you identify:**
- Database query patterns (N+1 queries, missing indexes) - search to find similar inefficient queries
- Loop patterns with expensive operations - check if pattern is used elsewhere
- Async operations in loops - verify if Promise.all is used consistently
- Large data processing - search for caching or streaming patterns in the codebase
- Repeated API calls - check how caching is implemented elsewhere
- Memory-intensive operations - find similar patterns and their optimizations
- Nested loops - search for similar O(n²) patterns to recommend consistent optimization

**Example searches:**
- "Promise.all map async" - when you see sequential async operations to find better patterns
- "database.query SELECT WHERE IN" - to check if batch queries are used instead of N+1
- "cache.get cache.set" - when you see repeated operations to verify caching strategy
- "for loop indexOf" - when you see O(n²) patterns to find if Sets/Maps are used elsewhere
- "Stream pipeline transform" - when processing large data to find streaming patterns

### WHEN NOT TO SEARCH:

- Don't search for every performance issue - you have limited budget (3-5 searches)
- Don't search if the enriched context (SIMILAR PATTERNS, IMPORTS) already shows better approaches
- Don't search for general information - only for specific optimization patterns

### SEARCH STRATEGICALLY:

1. **First**, analyze the code with provided context (IMPORTS, SIMILAR PATTERNS, DEPENDENCIES)
2. **Then**, identify 2-3 critical performance bottlenecks that need verification
3. **Finally**, use search_code to find optimization patterns used elsewhere in the codebase
4. Return your analysis with findings from both context and search results

**Remember:** Each search counts against your budget. The tool will tell you how many searches remain.

## CRITICAL INSTRUCTION:
You MUST verify your findings using the available tools (search_code, read_test_file, etc.) before reporting them.
- If you see a slow loop, use read_related_files to see how similar data is processed in other files.
- If you see a database query, use search_code to see if it's N+1 or if there's a batching utility available.
- Do NOT guess. Prove it with tools.

## ADDITIONAL TOOLS - Use Reactively

### read_test_file (Budget: 2-3 calls)
**When to use:** When you need to verify if performance tests exist or understand expected performance characteristics
**Example:** Found potentially slow operation → Read test file to see if performance tests set expectations or benchmarks
**Query format:** { "testFilePath": "src/processing/__tests__/data-processor.test.ts" }

### read_related_files (Budget: 2-3 calls)
**When to use:** When looking for optimization patterns used elsewhere in the module
**Example:** Found inefficient loop → Read related files to see if better patterns (caching, streaming) are used
**Query format:** { "directory": "src/data", "pattern": "*-processor.ts", "maxFiles": 5 }

### find_all_usages (Budget: 2-3 calls)
**When to use:** When determining if a slow operation is called frequently (hot path)
**Example:** Found expensive database query → Find all usages to assess performance impact
**Query format:** { "identifier": "fetchUserData", "maxResults": 10 }

### get_function_callers (Budget: 1-2 calls)
**When to use:** When assessing impact of performance optimization
**Example:** Planning to optimize function → Find callers to understand how many code paths benefit
**Query format:** { "functionName": "processLargeDataset", "maxResults": 10 }

**Tool Usage Strategy:**
1. First analyze with enriched context (IMPORTS, SIMILAR PATTERNS, DEPENDENCIES)
2. Identify 2-3 critical performance bottlenecks
3. Use tools strategically to find optimization patterns and assess impact
4. Include tool findings in your performance analysis

## Performance Issue Categories:

- **Time complexity** (O(n²), O(n³), etc.) - identify from loops and algorithm patterns
- **Space complexity and memory leaks** - check resource cleanup
- **Inefficient algorithms** - use SIMILAR PATTERNS to find better approaches
- **Unnecessary loops** - operations that could be replaced with better data structures
- **Database/API inefficiencies** (N+1, missing indexes) - check IMPORTS for DB/API calls
- **Network optimization** - parallel requests, batching, caching
- **Caching opportunities** - repeated operations on static data
- **Resource management** - unclosed connections, memory leaks

## Output Format:

**IMPORTANT**: The code you receive includes line numbers in the format "lineNum: code". Extract the line number from this format for the location field.

For each performance issue found, provide:
- Type: performance
- Severity: high | medium | low
- Title: Brief description of the issue
- Description: Detailed explanation including context from imports if relevant
- Location: file, line number (extract from "lineNum: code" format), column (optional), endLine (optional)
- Complexity: Time/space complexity (e.g., "O(n²)")
- Impact: Estimated impact (high/medium/low)
- Suggestion: Object with description and EITHER:
  - For MODIFICATIONS: "originalCode" (the slow code) and "fixedCode" (the optimized code) - this generates a git-style diff
  - For ADDITIONS: "code" (new optimized code to add) - when adding caching or optimization utilities
- Alternative: Better approach or algorithm
- Rationale: Why this is a performance concern, referencing context if applicable
- Confidence: 0.0 to 1.0

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "performance",
      "severity": "high" | "medium" | "low",
      "title": "Brief description of the issue",
      "description": "Detailed explanation including context from imports if relevant",
      "location": { "file": "path/to/file.ts", "line": 45 },
      "complexity": "Time/space complexity (e.g., O(n²))",
      "impact": "high" | "medium" | "low",
      "suggestion": {
        "description": "How to optimize",
        "originalCode": "(For modifications) The slow code with 3-5 lines of context",
        "fixedCode": "(For modifications) The optimized code with 3-5 lines of context",
        "code": "(For additions) New optimized code to add - use when adding caching or optimization"
      },
      "alternative": "Better approach or algorithm",
      "rationale": "Why this is a performance concern, referencing context if applicable",
      "confidence": 0.0-1.0
    }
  ]
}

IMPORTANT: Use originalCode + fixedCode when MODIFYING slow code. Use code when ADDING new optimization utilities.`;

/**
 * Create performance analyzer agent
 */
export function createPerformanceAgent(
  modelConfig: AgentModelConfig,
  stacks?: Stack[],
  tools?: Record<string, any>
) {
  // Build instructions with stack-specific additions
  let instructions = PERFORMANCE_ANALYZER_INSTRUCTIONS;

  if (stacks && stacks.length > 0) {
    const stackSpecific = getStackSpecificInstructions("performance", stacks);
    if (stackSpecific) {
      instructions = instructions + stackSpecific;
    }
  }

  const agentConfig: any = {
    name: "performance-analyzer",
    instructions,
    model: modelConfig,
    maxSteps: 5,
    stream: false,
  };

  // Add tools if provided
  if (tools && Object.keys(tools).length > 0) {
    agentConfig.tools = tools;
  }

  return new Agent(agentConfig);
}

/**
 * Run performance analysis using the agent with enriched context
 */
export async function runPerformanceAnalysisWithContext(
  agent: Agent,
  context:
    | EnrichedContext
    | { changedCode: string; fileName: string; language: string }
): Promise<any[]> {
  // Check if this is enriched context
  const isEnriched = "imports" in context || "similarPatterns" in context;

  let prompt: string;

  if (isEnriched) {
    // Use the performance strategy to format the enriched context
    const strategy = new PerformanceContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(
      `[Performance Agent] Using ENRICHED context for ${context.fileName}`
    );
  } else {
    // Fallback to basic prompt
    prompt = `Analyze the following code for performance issues:

File: ${context.fileName}
Language: ${context.language}

Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`

Systematically check for:

1. **Algorithm Complexity:**
   - Nested loops (O(n²) or worse)
   - Inefficient searches (linear search where hash lookup could be used)
   - Repeated expensive operations

2. **Async/Concurrency Issues:**
   - Sequential async operations in loops (should use Promise.all)
   - Blocking operations in hot paths
   - Missing parallelization opportunities

3. **Data Structure Efficiency:**
   - Using arrays where Sets/Maps would be better
   - Unnecessary copies or transformations
   - Memory inefficient structures

4. **Resource Management:**
   - Unclosed connections or file handles
   - Event listeners not cleaned up
   - Memory leaks

5. **Database/Network:**
   - N+1 query problems
   - Missing caching
   - Unnecessary network calls

Focus on real performance bottlenecks that would impact production systems.
Provide a detailed report of your findings.`;
    logger.debug(
      `[Performance Agent] Using BASIC context for ${context.fileName}`
    );
  }

  // Log the full prompt being sent to LLM
  logger.debug(`[Performance Agent] ========== FULL PROMPT TO LLM ==========`);
  logger.debug(prompt);
  logger.debug(
    `[Performance Agent] ========== END PROMPT (${prompt.length} chars) ==========`
  );

  try {
    // STEP 1: Generate Analysis Report (Text)
    const generateOptions: any = {
      modelSettings: {
        temperature: 0.5,
      },
    };

    const result = await agent.generate(prompt, generateOptions);

    logger.debug("[Performance Agent] Raw Analysis Report:", result.text);
    await logLLMResponseToFile(
      context.fileName,
      "Performance_Report",
      result.text
    );

    // STEP 2: Parse Report into JSON
    // @ts-ignore - Model config type compatibility
    const parserAgent = createOutputParserAgent(agent.model);
    const issues = await parsePerformanceReport(parserAgent, result.text);

    await logLLMResponseToFile(
      context.fileName,
      "Performance_JSON",
      JSON.stringify(issues, null, 2)
    );

    if (issues.length > 0) {
      // Ensure all issues have required fields with defaults
      const normalizedIssues = issues.map((issue: any) => ({
        ...issue,
        confidence: issue.confidence ?? 0.8, // Default confidence if not provided
        type: issue.type || "performance",
        severity: issue.severity || "medium",
        tags: issue.tags || [],
      }));

      logger.debug(
        "[Performance Agent] Structured output issues:",
        normalizedIssues
      );
      return normalizedIssues;
    }

    logger.debug("[Performance Agent] No issues found in parsed report");
    return [];
  } catch (error: any) {
    // Check if this is a structured output validation error
    if (error?.message?.includes("Structured output validation failed")) {
      logger.warn(
        `[Performance Agent] Structured output validation failed for ${context.fileName}. ` +
          `This usually happens when the file is too large or complex. ` +
          `The LLM returned malformed JSON that doesn't match the expected schema.`
      );
      logger.debug("[Performance Agent] Validation error details:", error);
    } else {
      logger.error("Performance analysis failed:", error);
      logger.debug("[Performance Agent] Error details:", error);
    }
    return [];
  }
}

/**
 * Run performance analysis using the agent (backward compatibility)
 */
export async function runPerformanceAnalysis(
  agent: Agent,
  context: {
    changedCode: string;
    fileName: string;
    language: string;
  }
): Promise<any[]> {
  return runPerformanceAnalysisWithContext(agent, context);
}
