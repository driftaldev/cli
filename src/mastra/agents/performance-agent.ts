import { Agent } from '@mastra/core';
import type { AgentModelConfig } from '../types.js';
import { codeAnalysisTools } from '../tools/code-analysis-tools.js';
import { logger } from '../../utils/logger.js';
import type { EnrichedContext } from '../../core/review/context-strategies.js';
import { PerformanceContextStrategy } from '../../core/review/context-strategies.js';
import type { Stack } from '@/core/indexer/stack-detector.js';
import { getStackSpecificInstructions } from './stack-prompts.js';

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

For each performance issue found, provide:
- Type: performance
- Severity: high | medium | low
- Title: Brief description of the issue
- Description: Detailed explanation including context from imports if relevant
- Location: file, line number, column (optional), endLine (optional)
- Complexity: Time/space complexity (e.g., "O(n²)")
- Impact: Estimated impact (high/medium/low)
- Suggestion: Object with description and code (the optimized code)
- Alternative: Better approach or algorithm
- Rationale: Why this is a performance concern, referencing context if applicable
- Confidence: 0.0 to 1.0

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "performance",
      "severity": "high",
      "title": "Sequential async operations in loop",
      "description": "Using await inside a loop causes operations to run sequentially. Per IMPORTS, loadAccount() is an async network call that could be parallelized",
      "location": { "file": "hooks/use-accounts.ts", "line": 45, "column": 5, "endLine": 48 },
      "complexity": "O(n) network requests executed sequentially",
      "impact": "high",
      "suggestion": {
        "description": "Use Promise.all to execute network calls in parallel",
        "code": "const accounts = await Promise.all(addresses.map(addr => horizonServer.loadAccount(addr)));"
      },
      "alternative": "Batch API call if backend supports it",
      "rationale": "Sequential network calls in loop cause total time = n * average_latency. With 10 accounts and 200ms latency, this takes 2 seconds instead of 200ms with parallelization",
      "confidence": 0.95
    }
  ]
}`;

/**
 * Create performance analyzer agent
 */
export function createPerformanceAgent(
  modelConfig: AgentModelConfig,
  stacks?: Stack[]
) {
  // Build instructions with stack-specific additions
  let instructions = PERFORMANCE_ANALYZER_INSTRUCTIONS;

  if (stacks && stacks.length > 0) {
    const stackSpecific = getStackSpecificInstructions('performance', stacks);
    if (stackSpecific) {
      instructions = instructions + stackSpecific;
    }
  }

  return new Agent({
    name: 'performance-analyzer',
    instructions,
    model: modelConfig,
    tools: {
      analyzeComplexity: codeAnalysisTools.analyzeComplexity,
      estimatePerformance: codeAnalysisTools.estimatePerformance,
    },
  });
}

/**
 * Run performance analysis using the agent with enriched context
 */
export async function runPerformanceAnalysisWithContext(
  agent: Agent,
  context: EnrichedContext | { changedCode: string; fileName: string; language: string }
): Promise<any[]> {
  // Check if this is enriched context
  const isEnriched = 'imports' in context || 'similarPatterns' in context;

  let prompt: string;

  if (isEnriched) {
    // Use the performance strategy to format the enriched context
    const strategy = new PerformanceContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(`[Performance Agent] Using ENRICHED context for ${context.fileName}`);
  } else {
    // Fallback to basic prompt
    prompt = `Analyze the following code for performance issues:

File: ${context.fileName}
Language: ${context.language}

Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`

Use the analyzeComplexity and estimatePerformance tools to assess the code, then systematically check for:

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
Return ONLY valid JSON with your findings.`;
    logger.debug(`[Performance Agent] Using BASIC context for ${context.fileName}`);
  }

  // Log the full prompt being sent to LLM
  logger.debug(`[Performance Agent] ========== FULL PROMPT TO LLM ==========`);
  logger.debug(prompt);
  logger.debug(`[Performance Agent] ========== END PROMPT (${prompt.length} chars) ==========`);

  try {
    const result = await agent.generate(prompt, {
      maxSteps: 3 // Allow tool use
    });

    logger.debug('[Performance Agent] Raw LLM response:', result.text);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      logger.debug('[Performance Agent] Extracted JSON:', jsonMatch[0]);
      const parsed = JSON.parse(jsonMatch[0]);
      const issues = parsed.issues || [];

      // Ensure all issues have required fields with defaults
      const normalizedIssues = issues.map((issue: any) => ({
        ...issue,
        confidence: issue.confidence ?? 0.8, // Default confidence if not provided
        type: issue.type || 'performance',
        severity: issue.severity || 'medium',
        tags: issue.tags || []
      }));

      logger.debug('[Performance Agent] Parsed issues:', normalizedIssues);
      return normalizedIssues;
    }

    logger.debug('[Performance Agent] No JSON found in response');
    return [];
  } catch (error) {
    console.error('Performance analysis failed:', error);
    logger.debug('[Performance Agent] Error details:', error);
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
