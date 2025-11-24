import { Agent } from "@mastra/core";
import type { AgentModelConfig } from "../types.js";
import { logger } from "../../utils/logger.js";
import type { EnrichedContext } from "../../core/review/context-strategies.js";
import { LogicContextStrategy } from "../../core/review/context-strategies.js";
import type { Stack } from "@/core/indexer/stack-detector.js";
import { getStackSpecificInstructions } from "./stack-prompts.js";
import { logLLMResponseToFile } from "../workflows/review-workflow.js";
import {
  createOutputParserAgent,
  parseLogicReport,
} from "./output-parser-agent.js";

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

## SEARCH_CODE TOOL - Use Reactively & Strategically

You have access to the **search_code** tool with a **3-5 search budget per file**.

### WHEN TO USE SEARCH (Reactive Strategy):

**DO search when you identify:**
- Missing await on async functions - search to verify function signature returns Promise
- Null/undefined handling - check how similar nullable patterns are handled elsewhere
- Error handling patterns - verify if try/catch is used consistently for similar operations
- Function signature mismatches - search for function definition to verify parameters/return type
- Edge case handling - find how empty arrays, null values, boundary conditions are handled elsewhere
- Type usage - search for type definition to understand correct usage
- Similar function calls - verify if other call sites handle nullability/errors correctly

**Example searches:**
- "function getUserById" - when you see it called without await to verify if it's async
- "array.length === 0" - when you see array access without checks to find guard patterns
- "try catch database" - when you see database operations without error handling
- "if (user === null)" - when reviewing nullable handling to verify consistency
- "Promise.reject Error" - when checking error propagation patterns

### WHEN NOT TO SEARCH:

- Don't search for every potential bug - you have limited budget (3-5 searches)
- Don't search if the enriched context (IMPORTS, TYPE DEFINITIONS) already shows the function signature
- Don't search for general information - only for specific patterns or definitions

### SEARCH STRATEGICALLY:

1. **First**, analyze the code with provided context (IMPORTS, TYPE DEFINITIONS, DEPENDENCIES)
2. **Then**, identify 2-3 critical bugs or missing checks that need verification
3. **Finally**, use search_code to verify function signatures, patterns, or handling approaches
4. Return your analysis with findings from both context and search results

**Remember:** Each search counts against your budget. The tool will tell you how many searches remain.

## ADDITIONAL TOOLS - Use Reactively

### read_test_file (Budget: 2-3 calls)
**When to use:** When you need to understand expected behavior, edge cases, or validate assumptions about how code should handle errors
**Example:** Found function without clear null handling → Read test file to see if nulls/errors are expected to be handled and if edge cases are covered
**Query format:** { "testFilePath": "src/utils/__tests__/validator.test.ts" }

### read_related_files (Budget: 2-3 calls)
**When to use:** When checking if error handling or null checks are applied consistently across a module
**Example:** Found missing null check → Read related files to see if similar functions have proper guards
**Query format:** { "directory": "src/api", "pattern": "*.ts", "maxFiles": 5 }

### find_all_usages (Budget: 2-3 calls)
**When to use:** When determining if a nullable return value is handled correctly at all call sites
**Example:** Function returns T | null but one call site missing null check → Find all usages to verify pattern
**Query format:** { "identifier": "getUserData", "maxResults": 10 }

### get_function_callers (Budget: 1-2 calls)
**When to use:** When assessing impact of a potential breaking change or verifying all callers handle errors correctly
**Example:** Found function that can throw but no try/catch → Find callers to see if error is handled upstream
**Query format:** { "functionName": "parseConfig", "maxResults": 10 }

**Tool Usage Strategy:**
1. First analyze with enriched context (IMPORTS, TYPE DEFINITIONS, DEPENDENCIES)
2. Identify 2-3 critical bugs or missing checks
3. Use tools strategically to verify patterns, test coverage, and error handling consistency
4. Include tool findings in your bug analysis

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

Provide a detailed report of your findings. For each issue, explain:
1. What the bug is
2. Where it is located (file and line)
3. Why it is a bug (rationale)
4. How to fix it (suggestion)
5. Severity and confidence

Be as specific as possible.`;

/**
 * Create logic analyzer agent
 */
export function createLogicAgent(
  modelConfig: AgentModelConfig,
  stacks?: Stack[],
  tools?: Record<string, any>
) {
  // Build instructions with stack-specific additions
  let instructions = LOGIC_ANALYZER_INSTRUCTIONS;

  if (stacks && stacks.length > 0) {
    const stackSpecific = getStackSpecificInstructions("logic", stacks);
    if (stackSpecific) {
      instructions = instructions + stackSpecific;
    }
  }

  const agentConfig: any = {
    name: "logic-analyzer",
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
 * Run logic analysis using the agent with enriched context
 */
export async function runLogicAnalysisWithContext(
  agent: Agent,
  context:
    | EnrichedContext
    | { changedCode: string; fileName: string; language: string },
  clientTools?: Record<string, any>
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

Systematically check for:

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

## CRITICAL INSTRUCTION:
You MUST verify your findings using the available tools (search_code, read_test_file, etc.) before reporting them.
- If you suspect a missing await, use search_code to find the function definition and verify it returns a Promise.
- If you suspect a null issue, use find_all_usages to see how it's handled elsewhere.
- Do NOT guess. Prove it with tools.

Focus on bugs that would cause runtime errors or incorrect behavior.
Provide a detailed report of your findings.`;
    logger.debug(`[Logic Agent] Using BASIC context for ${context.fileName}`);
  }

  // Log the full prompt being sent to LLM
  logger.debug(`[Logic Agent] ========== FULL PROMPT TO LLM ==========`);
  logger.debug(prompt);
  logger.debug(
    `[Logic Agent] ========== END PROMPT (${prompt.length} chars) ==========`
  );

  try {
    // STEP 1: Generate Analysis Report (Text)
    // We remove structuredOutput to allow the agent to "think" and use tools freely
    const generateOptions: any = {
      modelSettings: {
        temperature: 0.5, // Lower temperature to encourage tool use over creative writing
      },
    };

    // Add clientTools if provided
    if (clientTools && Object.keys(clientTools).length > 0) {
      generateOptions.clientTools = clientTools;
      logger.debug(`[Logic Agent] Passing ${Object.keys(clientTools).length} tools to generate: ${Object.keys(clientTools).join(", ")}`);
    }

    const result = await agent.generate(prompt, generateOptions);

    logger.debug("[Logic Agent] Raw Analysis Report:", result.text);
    await logLLMResponseToFile(context.fileName, "Logic_Report", result.text);

    // STEP 2: Parse Report into JSON
    // We use a specialized agent that strictly formats the output
    // @ts-ignore - Model config type compatibility
    const parserAgent = createOutputParserAgent(agent.model);
    const issues = await parseLogicReport(parserAgent, result.text);

    await logLLMResponseToFile(
      context.fileName,
      "Logic_JSON",
      JSON.stringify(issues, null, 2)
    );

    if (issues.length > 0) {
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

    logger.debug("[Logic Agent] No issues found in parsed report");
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
