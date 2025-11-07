import { Agent } from '@mastra/core';
import type { AgentModelConfig } from '../types.js';
import { codeAnalysisTools } from '../tools/code-analysis-tools.js';
import { logger } from '../../utils/logger.js';
import type { EnrichedContext } from '../../core/review/context-strategies.js';
import { PerformanceContextStrategy } from '../../core/review/context-strategies.js';

const PERFORMANCE_ANALYZER_INSTRUCTIONS = `You are a performance optimization expert. Analyze code for:
- Time complexity issues (O(n²), O(n³), etc.)
- Space complexity and memory leaks
- Inefficient algorithms and data structures
- Unnecessary loops and iterations
- Database query inefficiencies (N+1 problems, missing indexes)
- Network request optimization
- Caching opportunities
- Resource management (unclosed connections, file handles)

For each performance issue found, provide:
- Type: performance
- Severity: high | medium | low
- Title: Brief description of the issue
- Description: Detailed explanation of the performance impact
- Location: file, line number, column (optional), endLine (optional)
- Complexity: Time/space complexity (e.g., "O(n²)")
- Impact: Estimated impact (high/medium/low)
- Suggestion: Object with description and code (the optimized code)
- Alternative: Better approach or algorithm
- Rationale: Why this is a performance concern

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "performance",
      "severity": "high",
      "title": "Nested loop with O(n²) complexity",
      "description": "Two nested loops iterating over the same array",
      "location": { "file": "path/to/file.ts", "line": 25, "column": 5, "endLine": 28 },
      "complexity": "O(n²)",
      "impact": "high",
      "suggestion": {
        "description": "Use a Set or Map for O(1) lookups",
        "code": "const set = new Set(array);\nfor (const item of items) {\n  if (set.has(item)) { ... }\n}"
      },
      "alternative": "Convert inner array to Set before the loop",
      "rationale": "Current complexity will slow down significantly with large arrays",
      "confidence": 0.9
    }
  ]
}`;

/**
 * Create performance analyzer agent
 */
export function createPerformanceAgent(modelConfig: AgentModelConfig) {
  return new Agent({
    name: 'performance-analyzer',
    instructions: PERFORMANCE_ANALYZER_INSTRUCTIONS,
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

Use the analyzeComplexity and estimatePerformance tools to assess the code, then provide a comprehensive performance analysis.
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
