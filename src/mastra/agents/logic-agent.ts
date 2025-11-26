import { Agent } from "@mastra/core";
import type { AgentModelConfig } from "../types.js";
import { logger } from "../../utils/logger.js";
import type { EnrichedContext } from "../../core/review/context-strategies.js";
import { CodeContextStrategy } from "../../core/review/context-strategies.js";
import type { Stack } from "@/core/indexer/stack-detector.js";
import { getStackSpecificInstructions } from "./stack-prompts.js";
import { logLLMResponseToFile } from "../workflows/review-workflow.js";
import { LogicIssuesResponseSchema } from "../schemas/issue-schema.js";
import type { StreamEventCallback } from "../../ui/types/stream-events.js";

const CODE_ANALYZER_INSTRUCTIONS = `You are an expert at finding logic bugs, security vulnerabilities, and edge cases with deep contextual understanding.

## CRITICAL: Context-Aware Analysis

When analyzing code, you will receive enriched context including:
- **IMPORTS**: Definitions of imported functions/types showing signatures, return types, and whether functions are async
- **TYPE DEFINITIONS**: Interface and type definitions used in the code
- **SIMILAR PATTERNS**: How similar code patterns are used elsewhere
- **DEPENDENCIES**: Upstream and downstream dependencies

**YOU MUST cross-reference the changed code against this context to find bugs and security issues.**

### Systematic Analysis Workflow:

1. **Import Analysis - Check EVERY imported function usage:**
   - For each imported function in the IMPORTS section, identify its signature
   - If it returns Promise<T>, verify ALL usage sites have 'await' or proper .then() handling
   - If it returns T | null or T | undefined, verify null/undefined checks exist at usage sites
   - If parameters have specific types, verify all call sites match these types (count, order, type)
   - Example bug to catch: \`const keypair = getKeypair()\` when definition shows \`Promise<Keypair | null>\`
   - **Security**: Check for insecure imports (weak crypto, dangerous eval, unvalidated inputs)

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

8. **Security Vulnerabilities:**

   **CRITICAL PRIORITY: Logging & Secret Exposure**

   **YOU MUST systematically check EVERY logging statement in the changed code:**
   - Scan ALL: console.log(), console.error(), console.debug(), console.warn(), logger.info(), logger.debug(), logger.warn(), logger.error()
   - For Python: print(), logging.info(), logging.debug(), logging.error()
   - For Go: log.Printf(), fmt.Println(), log.Debug()

   **Flag ANY logging statement that includes:**

   a) **Hardcoded string literals that look like secrets:**
      - API keys starting with: sk-, pk-, api_key_, bearer_, token_
      - Long alphanumeric strings (20+ characters) that could be tokens
      - Patterns like: "-----BEGIN PRIVATE KEY-----", "SECRET_KEY="

   b) **Variables with sensitive names being logged:**
      - Variables named: password, secret, apiKey, privateKey, token, credential, auth, bearer
      - Configuration objects that might contain secrets

   c) **Environment or config exposure:**
      - process.env, ENV, config objects being logged directly
      - JSON.stringify(process.env) or similar serialization

   **EXAMPLES OF CRITICAL VULNERABILITIES TO DETECT:**

   // MUST FLAG ALL OF THESE:
   console.log("API key:", "sk-abc123...");              // ✗ Hardcoded key in log
   logger.info("Token: " + userToken);                   // ✗ Sensitive variable
   console.debug("Password is " + password);             // ✗ Password in log
   logger.error("Auth failed:", { secret: apiSecret });  // ✗ Secret in object
   console.log(process.env);                             // ✗ Full env exposure
   print(f"Redis key: {redis_secret}");                  // ✗ Python example
   log.Printf("Key: %s", API_KEY);                       // ✗ Go example

   **SAFE PATTERNS (do not flag):**

   console.log("API key:", apiKey?.substring(0, 7) + "..."); // ✓ Redacted
   logger.info("Token length:", token?.length);               // ✓ Metadata only
   logger.debug("Auth successful");                           // ✓ No sensitive data
   console.log("Config loaded:", Object.keys(config));       // ✓ Keys only, not values

   **Other Security Checks:**

   - **Input Validation**: SQL injection, XSS, command injection, path traversal
     * Check for user input concatenated into SQL queries or shell commands
     * Verify HTML output is properly escaped

   - **Authentication/Authorization**: Missing auth checks, broken access control
     * Endpoints without authentication middleware
     * Missing authorization checks before sensitive operations

   - **Cryptography**: Weak algorithms, improper key management
     * Flag MD5, SHA1 used for passwords (use bcrypt, argon2, scrypt instead)
     * Flag Math.random() for security tokens (use crypto.randomBytes)
     * Hardcoded cryptographic keys or salts

   - **API Security**: Missing rate limiting, CORS misconfigurations
     * Sensitive endpoints without security headers
     * Overly permissive CORS settings

## MANDATORY SECURITY VERIFICATION CHECKLIST

**Before completing your analysis, you MUST systematically verify:**

### ☐ LOGGING SECURITY (REQUIRED - CHECK FIRST)
- [ ] I have scanned EVERY console.log(), logger.info(), logger.debug(), logger.* statement in the changed code
- [ ] I have checked each logging statement for hardcoded string literals that look like secrets (sk-, pk-, api_key, bearer, token)
- [ ] I have verified no sensitive variable names (password, secret, token, apiKey, privateKey, credential) are being logged
- [ ] I have confirmed process.env or config objects are not being logged directly
- [ ] If I found any violations, I reported them with CRITICAL or HIGH severity

### ☐ INPUT VALIDATION
- [ ] User input is validated before use in SQL queries (no string concatenation)
- [ ] File paths from user input are sanitized (path traversal check)
- [ ] HTML output is properly escaped (XSS prevention)

### ☐ AUTHENTICATION & AUTHORIZATION
- [ ] API endpoints have authentication middleware
- [ ] Authorization checks exist before sensitive operations
- [ ] JWT tokens are not exposed in logs or client-side

### ☐ CRYPTOGRAPHY
- [ ] No weak algorithms (MD5, SHA1) for password hashing
- [ ] Secure random generation (crypto.randomBytes, not Math.random) for tokens
- [ ] No hardcoded cryptographic keys or salts

**If you're uncertain about a logging statement, use the search_code tool to verify if similar patterns exist in the codebase and how they handle secrets.**

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
- **Security vulnerabilities** - injection attacks, authentication bypass, sensitive data exposure
- **Cryptographic weaknesses** - weak algorithms, hardcoded keys, insecure random generation
- **Input validation failures** - XSS, SQL injection, command injection, path traversal
- **Authorization issues** - missing access controls, privilege escalation

## Output Format:

**IMPORTANT**: The code you receive includes line numbers in the format "lineNum: code". Extract the line number from this format for the location field.

For each logic bug found, provide:
- Type: bug
- Severity: critical | high | medium | low
- Title: Brief description of the bug
- Description: Detailed explanation including context from imports/types if relevant
- Location: file, line number (extract from "lineNum: code" format), column (optional), endLine (optional)
- ProblematicPath: The code path that causes the issue (optional)
- EdgeCases: Array of edge cases this bug affects (optional)
- Suggestion: Object with description and EITHER:
  - For MODIFICATIONS: "originalCode" (the buggy code) and "fixedCode" (the corrected code) - this generates a git-style diff
  - For ADDITIONS: "code" (new code to add) - when adding validation or error handling
- Rationale: Why this is a bug, referencing context if applicable
- Confidence: 0.0 to 1.0

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "bug",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Brief description",
      "description": "Detailed explanation",
      "location": { "file": "path/to/file.ts", "line": 42 },
      "problematicPath": "The code path causing the issue",
      "edgeCases": ["edge case 1", "edge case 2"],
      "suggestion": {
        "description": "How to fix the bug",
        "originalCode": "(For modifications) The buggy code with 3-5 lines of context",
        "fixedCode": "(For modifications) The corrected code with 3-5 lines of context",
        "code": "(For additions) New code to add - use when adding validation/error handling"
      },
      "rationale": "Why this is a bug",
      "confidence": 0.0-1.0
    }
  ]
}

IMPORTANT: Use originalCode + fixedCode when MODIFYING buggy code. Use code when ADDING new validation or error handling.`;

/**
 * Create code analyzer agent (combines logic and security analysis)
 */
export function createCodeAgent(
  modelConfig: AgentModelConfig,
  stacks?: Stack[],
  tools?: Record<string, any>
) {
  // Build instructions with stack-specific additions
  let instructions = CODE_ANALYZER_INSTRUCTIONS;

  if (stacks && stacks.length > 0) {
    // Try both "logic" and "security" stack-specific instructions
    const logicStackSpecific = getStackSpecificInstructions("logic", stacks);
    const securityStackSpecific = getStackSpecificInstructions(
      "security",
      stacks
    );

    if (logicStackSpecific) {
      instructions = instructions + logicStackSpecific;
    }
    if (securityStackSpecific) {
      instructions = instructions + securityStackSpecific;
    }
  }

  const agentConfig: any = {
    name: "code-analyzer",
    instructions,
    model: modelConfig,
    maxSteps: 5,
    stream: true,
  };

  // Add tools if provided
  if (tools && Object.keys(tools).length > 0) {
    agentConfig.tools = tools;
  }

  return new Agent(agentConfig);
}

// Keep the old name for backwards compatibility
export const createLogicAgent = createCodeAgent;

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
    // Use the code strategy to format the enriched context
    const strategy = new CodeContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(`[Code Agent] Using ENRICHED context for ${context.fileName}`);
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
  // logger.debug(prompt);
  logger.debug(
    `[Logic Agent] ========== END PROMPT (${prompt.length} chars) ==========`
  );

  try {
    // Generate structured JSON output directly
    const generateOptions: any = {
      modelSettings: {
        temperature: 0.5,
      },
      structuredOutput: {
        schema: LogicIssuesResponseSchema,
        errorStrategy: "warn",
        jsonPromptInjection: true,
      },
    };

    // Add clientTools if provided
    if (clientTools && Object.keys(clientTools).length > 0) {
      generateOptions.clientTools = clientTools;
      logger.debug(
        `[Logic Agent] Passing ${Object.keys(clientTools).length} tools to generate: ${Object.keys(clientTools).join(", ")}`
      );
    }

    const result = await agent.generate(prompt, generateOptions);

    console.log("this is the result in logic agent", result);

    logger.debug("[Logic Agent] Raw Analysis Report:", result.text);
    await logLLMResponseToFile(context.fileName, "Logic_Report", result.text);

    // Extract issues from structured output
    const issues = result.object?.issues || [];

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

/**
 * Run logic analysis with streaming support
 * Emits stream events for thinking/reasoning and text content
 */
export async function runLogicAnalysisStreaming(
  agent: Agent,
  context:
    | EnrichedContext
    | { changedCode: string; fileName: string; language: string },
  onStreamEvent: StreamEventCallback,
  clientTools?: Record<string, any>
): Promise<any[]> {
  // Check if this is enriched context
  const isEnriched = "imports" in context || "relatedTests" in context;

  let prompt: string;

  if (isEnriched) {
    const strategy = new CodeContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(`[Code Agent] Using ENRICHED context for ${context.fileName}`);
  } else {
    prompt = `Analyze the following code for logic bugs and edge cases:

File: ${context.fileName}
Language: ${context.language}

Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`

Focus on bugs that would cause runtime errors or incorrect behavior.
Provide a detailed report of your findings.`;
    logger.debug(`[Logic Agent] Using BASIC context for ${context.fileName}`);
  }

  try {
    const streamOptions: any = {
      modelSettings: {
        temperature: 0.5,
        // Enable reasoning for models that support it
        // This works for o1/o3 style models
        reasoningEffort: "high",
      },
      structuredOutput: {
        schema: LogicIssuesResponseSchema,
        errorStrategy: "warn",
        jsonPromptInjection: true,
      },
    };

    if (clientTools && Object.keys(clientTools).length > 0) {
      streamOptions.clientTools = clientTools;
    }

    // Use streaming
    const streamResult = await agent.stream(prompt, streamOptions);

    let fullText = "";
    let fullReasoning = "";
    let chunkCount = 0;
    const seenChunkTypes = new Set<string>();

    // Get the readable stream and consume it
    const reader = streamResult.fullStream.getReader();

    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;

        // Cast chunk for easier access
        const c = chunk as any;
        const chunkType = c.type;
        chunkCount++;
        seenChunkTypes.add(chunkType);

        // Log first few chunks in detail for debugging
        if (process.env.DRIFTAL_DEBUG === "1" && chunkCount <= 5) {
          logger.debug(
            `[Logic Agent] Chunk ${chunkCount}:`,
            JSON.stringify(c, null, 2)
          );
        }

        // Data can be in multiple places depending on the chunk type:
        // - c.value (for text-delta, reasoning-delta)
        // - c.textDelta (direct text delta)
        // - c.delta (for some providers)
        // - c.reasoning (direct reasoning content)

        // Handle reasoning/thinking chunks
        if (
          chunkType === "reasoning-delta" ||
          chunkType === "reasoning" ||
          chunkType === "thinking-delta" ||
          chunkType === "reasoning_delta"
        ) {
          // Try different locations for reasoning content
          const delta =
            c.value || c.textDelta || c.delta || c.reasoning || c.content || "";
          if (delta) {
            fullReasoning += delta;
            logger.debug(`[Logic Agent] Reasoning: ${fullReasoning}`);
            onStreamEvent({
              type: "thinking",
              content: fullReasoning,
              delta,
            });
          }
        }
        // Handle text output chunks
        else if (chunkType === "text-delta") {
          // Text delta content can be in different places
          const textDelta = c.value || c.textDelta || c.delta || c.text || "";

          // Check for embedded reasoning
          const reasoningDelta = c.reasoning || "";

          if (reasoningDelta) {
            fullReasoning += reasoningDelta;
            onStreamEvent({
              type: "thinking",
              content: fullReasoning,
              delta: reasoningDelta,
            });
          }

          if (textDelta) {
            fullText += textDelta;
          }
        }
        // Handle step-finish which may contain reasoning summary
        else if (chunkType === "step-finish" || chunkType === "finish") {
          const stepReasoning = c.reasoning || c.reasoningText || "";
          if (stepReasoning && !fullReasoning.includes(stepReasoning)) {
            fullReasoning += stepReasoning;
            onStreamEvent({
              type: "thinking",
              content: fullReasoning,
              delta: stepReasoning,
            });
          }
          logger.debug(`[Logic Agent] Step finished`, {
            hasReasoning: !!stepReasoning,
          });
        }
        // Handle 'object' type chunks - these may contain the actual model response
        else if (chunkType === "object") {
          // For object chunks, we might be getting partial JSON or other structured data
          // Log for debugging but don't treat as text
          if (process.env.DRIFTAL_DEBUG === "1") {
            logger.debug(`[Logic Agent] Object chunk received`, {
              chunk: c.object.issues,
            });
          }
        }
        // Log other unhandled chunk types for debugging
        else if (process.env.DRIFTAL_DEBUG === "1") {
          logger.debug(`[Logic Agent] Unhandled chunk type: ${chunkType}`, {
            keys: Object.keys(c),
          });
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Log summary of stream processing
    logger.debug(`[Logic Agent] Stream summary:`, {
      totalChunks: chunkCount,
      chunkTypesFound: Array.from(seenChunkTypes),
      reasoningCaptured: fullReasoning.length > 0,
      reasoningLength: fullReasoning.length,
      textCaptured: fullText.length > 0,
      textLength: fullText.length,
    });

    // Get the final output
    const finalOutput = await streamResult.getFullOutput();
    const issues = (finalOutput as any)?.object?.issues || [];

    // Try to get reasoning text from the stream result if not captured during streaming
    if (!fullReasoning) {
      try {
        const reasoningText = await streamResult.reasoningText;
        if (reasoningText) {
          fullReasoning = reasoningText;
          // Emit the reasoning as a single event since we didn't stream it
          onStreamEvent({
            type: "thinking",
            content: fullReasoning,
            delta: fullReasoning,
          });
          logger.debug(
            `[Logic Agent] Got reasoning from streamResult.reasoningText: ${reasoningText.substring(0, 100)}...`
          );
        }
      } catch (e) {
        // Reasoning not available, that's ok
        logger.debug(`[Logic Agent] No reasoning available from streamResult`);
      }
    }

    await logLLMResponseToFile(context.fileName, "Logic_Report", fullText);
    await logLLMResponseToFile(
      context.fileName,
      "Logic_JSON",
      JSON.stringify(issues, null, 2)
    );

    if (issues.length > 0) {
      const normalizedIssues = issues.map((issue: any) => ({
        ...issue,
        confidence: issue.confidence ?? 0.8,
        type: issue.type || "bug",
        severity: issue.severity || "medium",
        tags: issue.tags || [],
      }));
      return normalizedIssues;
    }

    return [];
  } catch (error: any) {
    if (error?.message?.includes("Structured output validation failed")) {
      logger.warn(
        `[Logic Agent] Structured output validation failed for ${context.fileName}.`
      );
    } else {
      logger.error("Logic analysis streaming failed:", error);
    }
    return [];
  }
}
