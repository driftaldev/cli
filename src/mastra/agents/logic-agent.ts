import { Agent } from '@mastra/core';
import type { AgentModelConfig } from '../types.js';
import { codeAnalysisTools } from '../tools/code-analysis-tools.js';
import { logger } from '../../utils/logger.js';
import type { EnrichedContext } from '../../core/review/context-strategies.js';
import { LogicContextStrategy } from '../../core/review/context-strategies.js';

const LOGIC_ANALYZER_INSTRUCTIONS = `You are an expert at finding logic bugs and edge cases. Focus on:
- Null/undefined handling
- Off-by-one errors
- Race conditions and concurrency issues
- Incorrect conditional logic
- Missing error handling
- Edge cases (empty arrays, negative numbers, boundary conditions)
- Type coercion issues
- Async/await mistakes
- Unhandled promise rejections
- Infinite loops
- Dead code

For each logic bug found, provide:
- Type: bug
- Severity: critical | high | medium | low
- Title: Brief description of the bug
- Description: Clear explanation of the logic error
- Location: file, line number, column (optional), endLine (optional)
- ProblematicPath: The code path that triggers the bug
- EdgeCases: List of edge cases that expose the bug
- Suggestion: Object with description and code (the corrected code)
- Rationale: Why this is a bug

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "bug",
      "severity": "high",
      "title": "Null pointer exception on empty array",
      "description": "Array access without checking if array is empty",
      "location": { "file": "path/to/file.ts", "line": 15, "column": 8, "endLine": 17 },
      "problematicPath": "When items.length === 0, items[0] is undefined",
      "edgeCases": ["Empty array", "Array with only undefined elements"],
      "suggestion": {
        "description": "Add null check before array access",
        "code": "if (items.length > 0) {\n  const firstItem = items[0];\n  // ...\n}"
      },
      "rationale": "Accessing items[0] without checking array length causes runtime error",
      "confidence": 0.95
    }
  ]
}`;

/**
 * Create logic analyzer agent
 */
export function createLogicAgent(modelConfig: AgentModelConfig) {
  return new Agent({
    name: 'logic-analyzer',
    instructions: LOGIC_ANALYZER_INSTRUCTIONS,
    model: modelConfig,
    tools: {
      analyzeComplexity: codeAnalysisTools.analyzeComplexity,
    },
  });
}

/**
 * Run logic analysis using the agent with enriched context
 */
export async function runLogicAnalysisWithContext(
  agent: Agent,
  context: EnrichedContext | { changedCode: string; fileName: string; language: string }
): Promise<any[]> {
  // Check if this is enriched context
  const isEnriched = 'imports' in context || 'relatedTests' in context;

  let prompt: string;

  if (isEnriched) {
    // Use the logic strategy to format the enriched context
    const strategy = new LogicContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(`[Logic Agent] Using ENRICHED context for ${context.fileName}`);
  } else {
    // Fallback to basic prompt
    prompt = `Analyze the following code for logic bugs and edge cases:

File: ${context.fileName}
Language: ${context.language}

Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`

Use the analyzeComplexity tool if needed, then identify logic bugs, edge cases, and error handling issues.
Focus on bugs that would cause runtime errors or incorrect behavior.
Consider null/undefined, empty collections, boundary values, and async issues.
Return ONLY valid JSON with your findings.`;
    logger.debug(`[Logic Agent] Using BASIC context for ${context.fileName}`);
  }

  // Log the full prompt being sent to LLM
  logger.debug(`[Logic Agent] ========== FULL PROMPT TO LLM ==========`);
  logger.debug(prompt);
  logger.debug(`[Logic Agent] ========== END PROMPT (${prompt.length} chars) ==========`);

  try {
    const result = await agent.generate(prompt, {
      maxSteps: 3 // Allow tool use
    });

    logger.debug('[Logic Agent] Raw LLM response:', result.text);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      logger.debug('[Logic Agent] Extracted JSON:', jsonMatch[0]);
      const parsed = JSON.parse(jsonMatch[0]);
      const issues = parsed.issues || [];

      // Ensure all issues have required fields with defaults
      const normalizedIssues = issues.map((issue: any) => ({
        ...issue,
        confidence: issue.confidence ?? 0.8, // Default confidence if not provided
        type: issue.type || 'bug',
        severity: issue.severity || 'medium',
        tags: issue.tags || []
      }));

      logger.debug('[Logic Agent] Parsed issues:', normalizedIssues);
      return normalizedIssues;
    }

    logger.debug('[Logic Agent] No JSON found in response');
    return [];
  } catch (error) {
    console.error('Logic analysis failed:', error);
    logger.debug('[Logic Agent] Error details:', error);
    return [];
  }
}

/**
 * Run logic analysis using the agent (backward compatibility)
 */
export async function runLogicAnalysis(
  agent: Agent,
  context: {
    changedCode: string;
    fileName: string;
    language: string;
  }
): Promise<any[]> {
  return runLogicAnalysisWithContext(agent, context);
}
