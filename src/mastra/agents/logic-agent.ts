import { Agent } from "@mastra/core";
import type { AgentModelConfig } from "../types.js";
import { codeAnalysisTools } from "../tools/code-analysis-tools.js";
import { logger } from "../../utils/logger.js";
import type { EnrichedContext } from "../../core/review/context-strategies.js";
import { LogicContextStrategy } from "../../core/review/context-strategies.js";
import type { Stack } from "@/core/indexer/stack-detector.js";
import { getStackSpecificInstructions } from "./stack-prompts.js";
import { logLLMResponseToFile } from "../workflows/review-workflow.js";
import { LogicIssuesResponseSchema } from "../schemas/issue-schema.js";

const LOGIC_ANALYZER_INSTRUCTIONS = `You are an expert at finding logic bugs and edge cases with deep contextual understanding.

## CRITICAL: Context-Aware Analysis

When analyzing code, you will receive enriched context including:
- **IMPORTS**: Definitions of imported functions/types showing signatures, return types, and whether functions are async
- **TYPE DEFINITIONS**: Interface and type definitions used in the code
- **SIMILAR PATTERNS**: How similar code patterns are used elsewhere
- **DEPENDENCIES**: Upstream and downstream dependencies

**YOU MUST cross-reference the changed code against this context to find bugs.**

### Systematic Analysis Workflow:

1. **Import Analysis - Check EVERY imported function usage:**
   - For each imported function in the IMPORTS section, identify its signature
   - If it returns Promise<T>, verify ALL usage sites have 'await' or proper .then() handling
   - If it returns T | null or T | undefined, verify null/undefined checks exist at usage sites
   - If parameters have specific types, verify all call sites match these types (count, order, type)
   - Example bug to catch: \`const keypair = getKeypair()\` when definition shows \`Promise<Keypair | null>\`

2. **Type Consistency:**
   - Compare variable assignments against TYPE DEFINITIONS section
   - Check if object shapes match expected interfaces
   - Verify generic type parameters are used correctly
   - Look for implicit any types that could hide bugs

3. **Async/Promise Handling:**
   - Missing await on Promise-returning functions (check IMPORTS for async signatures)
   - Unhandled promise rejections (missing catch or try/catch)
   - Race conditions in concurrent async operations
   - Async functions not marked as async
   - Promise chains with missing error handlers
   - Mixing callbacks and promises incorrectly

4. **Null/Undefined Safety:**
   - Check IMPORTS for nullable return types (T | null, T | undefined)
   - Verify null checks before accessing properties or methods
   - Optional chaining opportunities (?.)
   - Nullish coalescing opportunities (??)

5. **Edge Cases:**
   - Empty arrays/objects (check length before access)
   - Boundary conditions (0, -1, max values)
   - Division by zero
   - Off-by-one errors in loops
   - Invalid array indices

6. **Error Handling:**
   - Try/catch blocks for operations that can throw
   - Proper error propagation
   - User-facing error messages

7. **Control Flow:**
   - Unreachable code (dead code)
   - Incorrect conditional logic
   - Infinite loops
   - Missing return statements

## Classic Bug Categories to Check:

- **Null/undefined handling** - especially when imports show nullable returns
- **Off-by-one errors**
- **Race conditions and concurrency issues**
- **Incorrect conditional logic**
- **Missing error handling**
- **Edge cases** (empty arrays, negative numbers, boundary conditions)
- **Type coercion issues**
- **Async/await mistakes** - CRITICAL: cross-reference with import signatures
- **Unhandled promise rejections**
- **Infinite loops**
- **Dead code**
- **API misuse** - using imported functions incorrectly based on their definitions

## Output Format:

**IMPORTANT**: The code you receive includes line numbers in the format "lineNum: code". Extract the line number from this format for the location field.

For each logic bug found, provide:
- Type: bug
- Severity: critical | high | medium | low
- Title: Brief description of the bug
- Description: Clear explanation including context from imports if relevant
- Location: file, line number (extract from "lineNum: code" format), column (optional), endLine (optional)
- ProblematicPath: The code path that triggers the bug
- EdgeCases: List of edge cases that expose the bug
- Suggestion: Object with description and EITHER:
  - For MODIFICATIONS: "originalCode" (the buggy code) and "fixedCode" (the corrected code) - this generates a git-style diff
  - For ADDITIONS: "code" (new code to add) - when adding entirely new validation or logic
- Rationale: Why this is a bug, referencing import definitions if applicable
- Confidence: 0.0 to 1.0 (how confident you are this is a real bug)

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "bug",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Brief description of the bug",
      "description": "Clear explanation including context from imports if relevant",
      "location": { "file": "path/to/file.ts", "line": 167 },
      "problematicPath": "The code path that triggers the bug",
      "edgeCases": ["Edge case 1", "Edge case 2"],
      "suggestion": {
        "description": "How to fix the bug",
        "originalCode": "(For modifications) The buggy code with 3-5 lines of context",
        "fixedCode": "(For modifications) The corrected code with 3-5 lines of context",
        "code": "(For additions) New code to add - use when adding validation or error handling"
      },
      "rationale": "Why this is a bug, referencing import definitions if applicable",
      "confidence": 0.0-1.0
    }
  ]
}

IMPORTANT: Use originalCode + fixedCode when MODIFYING buggy code. Use code when ADDING new validation or error handling.`;

/**
 * Create logic analyzer agent
 */
export function createLogicAgent(
  modelConfig: AgentModelConfig,
  stacks?: Stack[]
) {
  // Build instructions with stack-specific additions
  let instructions = LOGIC_ANALYZER_INSTRUCTIONS;

  if (stacks && stacks.length > 0) {
    const stackSpecific = getStackSpecificInstructions("logic", stacks);
    if (stackSpecific) {
      instructions = instructions + stackSpecific;
    }
  }

  return new Agent({
    name: "logic-analyzer",
    instructions,
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
  context:
    | EnrichedContext
    | { changedCode: string; fileName: string; language: string }
): Promise<any[]> {
  // Check if this is enriched context
  const isEnriched = "imports" in context || "relatedTests" in context;

  let prompt: string;

  if (isEnriched) {
    // Use the logic strategy to format the enriched context
    const strategy = new LogicContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(
      `[Logic Agent] Using ENRICHED context for ${context.fileName}`
    );
  } else {
    // Fallback to basic prompt
    prompt = `Analyze the following code for logic bugs and edge cases:

File: ${context.fileName}
Language: ${context.language}

Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`

Use the analyzeComplexity tool if needed, then systematically check for:

1. **Async/Promise Issues:**
   - Missing await keywords on async function calls (look for functions returning Promises)
   - Unhandled promise rejections
   - Async functions not properly marked as async
   - Race conditions in concurrent operations

2. **Null/Undefined Safety:**
   - Accessing properties without null checks
   - Array/object access without length/existence checks
   - Function calls without checking if function exists

3. **Type Consistency:**
   - Variables used incorrectly based on their type
   - Parameter mismatches in function calls
   - Return type mismatches

4. **Edge Cases:**
   - Empty arrays/objects/strings
   - Boundary conditions (0, -1, max values)
   - Division by zero
   - Off-by-one errors

5. **Error Handling:**
   - Missing try/catch for operations that can throw
   - Improper error propagation

Focus on bugs that would cause runtime errors or incorrect behavior.
Return ONLY valid JSON with your findings.`;
    logger.debug(`[Logic Agent] Using BASIC context for ${context.fileName}`);
  }

  // Log the full prompt being sent to LLM
  logger.debug(`[Logic Agent] ========== FULL PROMPT TO LLM ==========`);
  logger.debug(prompt);
  logger.debug(
    `[Logic Agent] ========== END PROMPT (${prompt.length} chars) ==========`
  );

  try {
    const result = await agent.generate(prompt, {
      structuredOutput: {
        schema: LogicIssuesResponseSchema,
        errorStrategy: "warn",
        jsonPromptInjection: true,
      },
    });

    logger.debug("[Logic Agent] Raw LLM response:", result.text);

    // Log LLM response to file
    await logLLMResponseToFile(context.fileName, "Logic", result.text);

    // Access structured output directly from result.object
    if (result.object && result.object.issues) {
      const issues = result.object.issues;

      // Ensure all issues have required fields with defaults
      const normalizedIssues = issues.map((issue: any) => ({
        ...issue,
        confidence: issue.confidence ?? 0.8, // Default confidence if not provided
        type: issue.type || "bug",
        severity: issue.severity || "medium",
        tags: issue.tags || [],
      }));

      logger.debug("[Logic Agent] Structured output issues:", normalizedIssues);
      return normalizedIssues;
    }

    logger.debug("[Logic Agent] No issues found in structured output");
    return [];
  } catch (error: any) {
    // Check if this is a structured output validation error
    if (error?.message?.includes("Structured output validation failed")) {
      logger.warn(
        `[Logic Agent] Structured output validation failed for ${context.fileName}. ` +
          `This usually happens when the file is too large or complex. ` +
          `The LLM returned malformed JSON that doesn't match the expected schema.`
      );
      logger.debug("[Logic Agent] Validation error details:", error);
    } else {
      logger.error("Logic analysis failed:", error);
      logger.debug("[Logic Agent] Error details:", error);
    }
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
