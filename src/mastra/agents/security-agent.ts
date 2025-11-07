import { Agent } from '@mastra/core';
import type { AgentModelConfig } from '../types.js';
import { codeAnalysisTools } from '../tools/code-analysis-tools.js';
import { logger } from '../../utils/logger.js';
import type { EnrichedContext } from '../../core/review/context-strategies.js';
import { SecurityContextStrategy } from '../../core/review/context-strategies.js';

const SECURITY_ANALYZER_INSTRUCTIONS = `You are a security expert specializing in:
- OWASP Top 10 vulnerabilities
- SQL injection, XSS, CSRF attacks
- Authentication and authorization flaws
- Secret and credential detection
- Input validation and sanitization
- Cryptographic issues
- Dependency vulnerabilities

Analyze code changes for security vulnerabilities. Focus on:
1. Injection attacks (SQL, NoSQL, command injection, XSS)
2. Broken authentication and session management
3. Sensitive data exposure
4. XML External Entities (XXE)
5. Broken access control
6. Security misconfiguration
7. Insecure deserialization
8. Using components with known vulnerabilities
9. Insufficient logging and monitoring
10. Server-Side Request Forgery (SSRF)

For each security issue found, provide:
- Type: security
- Severity: critical | high | medium | low
- Title: Brief description of the vulnerability
- Description: Detailed explanation of the security risk
- Location: file, line number, column (optional), endLine (optional)
- CWE ID: If applicable (e.g., CWE-89 for SQL Injection)
- Suggestion: Object with description and code (the actual fixed code)
- Rationale: Why this is a security concern

Output ONLY valid JSON in this format:
{
  "issues": [
    {
      "type": "security",
      "severity": "critical",
      "title": "SQL Injection vulnerability",
      "description": "User input is directly concatenated into SQL query",
      "location": { "file": "path/to/file.ts", "line": 42, "column": 10, "endLine": 44 },
      "cwe": "CWE-89",
      "suggestion": {
        "description": "Use parameterized queries or prepared statements",
        "code": "const result = await db.query('SELECT * FROM users WHERE id = ?', [userId]);"
      },
      "rationale": "Allows attackers to execute arbitrary SQL commands",
      "confidence": 0.95
    }
  ]
}`;

/**
 * Create security analyzer agent
 */
export function createSecurityAgent(modelConfig: AgentModelConfig) {
  return new Agent({
    name: 'security-analyzer',
    instructions: SECURITY_ANALYZER_INSTRUCTIONS,
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
  context: EnrichedContext | { changedCode: string; fileName: string; language: string }
): Promise<any[]> {
  // Check if this is enriched context
  const isEnriched = 'imports' in context || 'typeDefinitions' in context;

  let prompt: string;

  if (isEnriched) {
    // Use the security strategy to format the enriched context
    const strategy = new SecurityContextStrategy();
    prompt = strategy.formatPrompt(context as EnrichedContext);
    logger.debug(`[Security Agent] Using ENRICHED context for ${context.fileName}`);
  } else {
    // Fallback to basic prompt
    prompt = `Analyze the following code for security vulnerabilities:

File: ${context.fileName}
Language: ${context.language}

Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`

Use the detectVulnerabilities tool to scan for common security issues, then provide a comprehensive security analysis.
Focus on real, exploitable vulnerabilities. Avoid false positives.
Return ONLY valid JSON with your findings.`;
    logger.debug(`[Security Agent] Using BASIC context for ${context.fileName}`);
  }

  // Log the full prompt being sent to LLM
  logger.debug(`[Security Agent] ========== FULL PROMPT TO LLM ==========`);
  logger.debug(prompt);
  logger.debug(`[Security Agent] ========== END PROMPT (${prompt.length} chars) ==========`);

  try {
    const result = await agent.generate(prompt, {
      maxSteps: 3 // Allow tool use
    });

    logger.debug('[Security Agent] Raw LLM response:', result.text);

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      logger.debug('[Security Agent] Extracted JSON:', jsonMatch[0]);
      const parsed = JSON.parse(jsonMatch[0]);
      const issues = parsed.issues || [];

      // Ensure all issues have required fields with defaults
      const normalizedIssues = issues.map((issue: any) => ({
        ...issue,
        confidence: issue.confidence ?? 0.8, // Default confidence if not provided
        type: issue.type || 'security',
        severity: issue.severity || 'medium',
        tags: issue.tags || []
      }));

      logger.debug('[Security Agent] Parsed issues:', normalizedIssues);
      return normalizedIssues;
    }

    logger.debug('[Security Agent] No JSON found in response');
    return [];
  } catch (error) {
    console.error('Security analysis failed:', error);
    logger.debug('[Security Agent] Error details:', error);
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
