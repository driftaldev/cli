import { Agent } from "@mastra/core";
import type { AgentModelConfig } from "../types.js";
import { codeAnalysisTools } from "../tools/code-analysis-tools.js";
import { logger } from "../../utils/logger.js";
import type { EnrichedContext } from "../../core/review/context-strategies.js";
import { SecurityContextStrategy } from "../../core/review/context-strategies.js";
import type { Stack } from "@/core/indexer/stack-detector.js";
import { getStackSpecificInstructions } from "./stack-prompts.js";
import { logLLMResponseToFile } from "../workflows/review-workflow.js";
import { SecurityIssuesResponseSchema } from "../schemas/issue-schema.js";

const SECURITY_ANALYZER_INSTRUCTIONS = `You are a security expert with deep contextual understanding and OWASP Top 10 expertise.

## CRITICAL: Context-Aware Security Analysis

When analyzing code, you will receive enriched context including:
- **IMPORTS**: Security-critical imports (crypto, auth, database, network, file system)
- **TYPE DEFINITIONS**: Data structures that may contain sensitive information
- **DEPENDENCIES**: Related files that establish security boundaries and trust zones
- **SIMILAR PATTERNS**: Security patterns used elsewhere in the codebase

**YOU MUST use this context to identify security vulnerabilities.**

### Systematic Security Analysis Workflow:

1. **Import-Based Security Analysis:**
   - Identify security-critical imports from IMPORTS section (crypto, auth, database, eval, exec, child_process)
   - Check if crypto imports use secure algorithms (no MD5, SHA1 for hashing; require strong encryption)
   - Verify auth imports are used correctly (proper token validation, session management)
   - Check database imports for injection vulnerabilities
   - Look for dangerous imports (eval, exec, innerHTML) that need sanitization

2. **Input Validation & Injection:**
   - Check all user inputs against TYPE DEFINITIONS
   - SQL/NoSQL injection: verify parameterized queries when using database imports
   - XSS: check HTML/DOM manipulation for proper escaping
   - Command injection: verify shell command construction from IMPORTS
   - Path traversal: check file system operations
   - LDAP/XML injection: verify input sanitization

3. **Authentication & Authorization:**
   - Verify proper use of auth functions from IMPORTS
   - Check for hardcoded credentials or secrets (even in test code)
   - Session management: token expiration, secure storage
   - Access control: verify permissions checked before sensitive operations
   - Check DEPENDENCIES for auth boundaries

4. **Sensitive Data Exposure:**
   - Identify sensitive fields in TYPE DEFINITIONS (password, token, secret, key, ssn, credit card)
   - Verify sensitive data is encrypted in transit and at rest
   - Check logging doesn't expose secrets
   - Verify proper error messages (no information leakage)
   - Check if sensitive data in types is properly protected

5. **Cryptographic Security:**
   - Check IMPORTS for crypto usage
   - Verify strong algorithms (AES-256, RSA-2048+, SHA-256+)
   - No weak crypto (DES, 3DES, MD5, SHA1 for passwords)
   - Proper random number generation (crypto.randomBytes, not Math.random)
   - Secure key management

6. **API & Network Security:**
   - SSRF: user-controlled URLs in fetch/http imports
   - CSRF: verify CSRF tokens for state-changing operations
   - Check HTTP headers for security (CORS, CSP, HSTS)
   - TLS/SSL usage for sensitive operations

7. **Dependency Security:**
   - Check DEPENDENCIES for known vulnerable patterns
   - Verify proper use of security libraries
   - Check for insecure deserialization

8. **Access Control:**
   - Verify authorization checks before sensitive operations
   - Check DEPENDENCIES to understand trust boundaries
   - Missing authorization on sensitive endpoints/functions

## OWASP Top 10 Focus Areas:

1. **Injection** (SQL, NoSQL, Command, XSS) - cross-check with IMPORTS
2. **Broken Authentication** - check auth patterns in IMPORTS and DEPENDENCIES
3. **Sensitive Data Exposure** - identify from TYPE DEFINITIONS
4. **XML External Entities (XXE)** - if XML parsing imports present
5. **Broken Access Control** - verify authorization with DEPENDENCIES context
6. **Security Misconfiguration** - hardcoded secrets, debug mode
7. **Cross-Site Scripting (XSS)** - check DOM/HTML manipulation
8. **Insecure Deserialization** - check serialization imports
9. **Using Components with Known Vulnerabilities** - audit IMPORTS
10. **Insufficient Logging & Monitoring** - verify security event logging

## Output Format:

**IMPORTANT**: The code you receive includes line numbers in the format "lineNum: code". Extract the line number from this format for the location field.

For each security issue found, provide:
- Type: security
- Severity: critical | high | medium | low
- Title: Brief description of the vulnerability
- Description: Detailed explanation including context from imports/types if relevant
- Location: file, line number (extract from "lineNum: code" format), column (optional), endLine (optional)
- CWE ID: If applicable (e.g., CWE-89, CWE-79, CWE-352)
- Suggestion: Object with description and EITHER:
  - For MODIFICATIONS: "originalCode" (the vulnerable code) and "fixedCode" (the secure code) - this generates a git-style diff
  - For ADDITIONS: "code" (new secure code to add) - when adding security measures like validation
- Rationale: Why this is a security concern, referencing context if applicable
- Confidence: 0.0 to 1.0

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "security",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Brief description",
      "description": "Detailed explanation",
      "location": { "file": "path/to/file.ts", "line": 42 },
      "cwe": "CWE-XXX",
      "suggestion": {
        "description": "How to fix the vulnerability",
        "originalCode": "(For modifications) The vulnerable code with 3-5 lines of context",
        "fixedCode": "(For modifications) The secure version with 3-5 lines of context",
        "code": "(For additions) New secure code to add - use this when adding validation/sanitization"
      },
      "rationale": "Why this is a security concern",
      "confidence": 0.0-1.0
    }
  ]
}

IMPORTANT: Use originalCode + fixedCode when MODIFYING vulnerable code. Use code when ADDING new security measures.`;

/**
 * Create security analyzer agent
 */
export function createSecurityAgent(
  modelConfig: AgentModelConfig,
  stacks?: Stack[]
) {
  // Build instructions with stack-specific additions
  let instructions = SECURITY_ANALYZER_INSTRUCTIONS;

  if (stacks && stacks.length > 0) {
    const stackSpecific = getStackSpecificInstructions("security", stacks);
    if (stackSpecific) {
      instructions = instructions + stackSpecific;
    }
  }

  return new Agent({
    name: "security-analyzer",
    instructions,
    model: modelConfig,
    tools: {
      detectVulnerabilities: codeAnalysisTools.detectVulnerabilities,
    },
  });
}

/**
 * Run security analysis using the agent with enriched context
 */
export async function runSecurityAnalysisWithContext(
  agent: Agent,
  context:
    | EnrichedContext
    | { changedCode: string; fileName: string; language: string }
): Promise<any[]> {
  // Check if this is enriched context
  const isEnriched = "imports" in context || "typeDefinitions" in context;

  let prompt: string;

  if (isEnriched) {
    // Use the security strategy to format the enriched context
    const strategy = new SecurityContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(
      `[Security Agent] Using ENRICHED context for ${context.fileName}`
    );
  } else {
    // Fallback to basic prompt
    prompt = `Analyze the following code for security vulnerabilities:

File: ${context.fileName}
Language: ${context.language}

Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`

Use the detectVulnerabilities tool to scan for common security issues, then systematically check for:

1. **Injection Vulnerabilities:**
   - SQL injection (string concatenation in queries)
   - XSS (unsanitized user input in HTML)
   - Command injection (user input in shell commands)
   - Path traversal (user input in file paths)

2. **Authentication & Authorization:**
   - Hardcoded credentials or secrets
   - Missing authorization checks
   - Weak session management
   - Insecure token handling

3. **Sensitive Data Exposure:**
   - Passwords/secrets in logs or error messages
   - Unencrypted sensitive data
   - Exposed API keys or tokens
   - Information leakage in error messages

4. **Cryptographic Issues:**
   - Weak algorithms (MD5, SHA1 for passwords)
   - Insecure random number generation (Math.random for security)
   - Hardcoded encryption keys
   - Missing encryption for sensitive data

5. **API Security:**
   - SSRF vulnerabilities (user-controlled URLs)
   - Missing CSRF protection
   - Insecure CORS configuration
   - Missing rate limiting

Focus on real, exploitable vulnerabilities. Avoid false positives.
Return ONLY valid JSON with your findings.`;
    logger.debug(
      `[Security Agent] Using BASIC context for ${context.fileName}`
    );
  }

  // Log the full prompt being sent to LLM
  logger.debug(`[Security Agent] ========== FULL PROMPT TO LLM ==========`);
  logger.debug(prompt);
  logger.debug(
    `[Security Agent] ========== END PROMPT (${prompt.length} chars) ==========`
  );

  try {
    const result = await agent.generate(prompt, {
      structuredOutput: {
        schema: SecurityIssuesResponseSchema,
        errorStrategy: "warn",
      },
    });

    logger.debug("[Security Agent] Raw LLM response:", result.text);

    // Log LLM response to file
    await logLLMResponseToFile(context.fileName, "Security", result.text);

    // Access structured output directly from result.object
    if (result.object && result.object.issues) {
      const issues = result.object.issues;

      // Ensure all issues have required fields with defaults
      const normalizedIssues = issues.map((issue: any) => ({
        ...issue,
        confidence: issue.confidence ?? 0.8, // Default confidence if not provided
        type: issue.type || "security",
        severity: issue.severity || "medium",
        tags: issue.tags || [],
      }));

      logger.debug(
        "[Security Agent] Structured output issues:",
        normalizedIssues
      );
      return normalizedIssues;
    }

    logger.debug("[Security Agent] No issues found in structured output");
    return [];
  } catch (error) {
    logger.error("Security analysis failed:", error);
    logger.debug("[Security Agent] Error details:", error);
    return [];
  }
}

/**
 * Run security analysis using the agent (backward compatibility)
 */
export async function runSecurityAnalysis(
  agent: Agent,
  context: {
    changedCode: string;
    fileName: string;
    language: string;
  }
): Promise<any[]> {
  return runSecurityAnalysisWithContext(agent, context);
}
