import { z } from "zod";

/**
 * Tool definitions for code analysis
 * These tools will be used by Mastra agents during code review
 */

/**
 * Analyze code complexity
 */
export const analyzeComplexityTool = {
  id: 'analyze-complexity',
  description: 'Analyze the complexity of code (cyclomatic complexity, nesting depth, etc.)',
  inputSchema: z.object({
    code: z.string().describe('The code to analyze'),
    language: z.string().describe('Programming language')
  }),
  execute: async ({ code, language }: { code: string; language: string }) => {
    // Calculate basic complexity metrics
    let complexity = 0;

    // Count control flow statements
    const controlKeywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'catch'];
    for (const keyword of controlKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = code.match(regex);
      complexity += matches ? matches.length : 0;
    }

    // Calculate nesting depth
    const lines = code.split('\n');
    let maxDepth = 0;
    let currentDepth = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith('{')) currentDepth++;
      if (trimmed.startsWith('}')) currentDepth--;
      maxDepth = Math.max(maxDepth, currentDepth);
    }

    return {
      cyclomaticComplexity: complexity,
      nestingDepth: maxDepth,
      linesOfCode: lines.length,
      recommendation: complexity > 10 ? 'Consider refactoring - high complexity' : 'Complexity is acceptable'
    };
  }
};

/**
 * Detect potential security vulnerabilities
 */
export const detectVulnerabilitiesTool = {
  id: 'detect-vulnerabilities',
  description: 'Scan code for common security vulnerabilities',
  inputSchema: z.object({
    code: z.string().describe('The code to scan'),
    language: z.string().describe('Programming language')
  }),
  execute: async ({ code, language }: { code: string; language: string }) => {
    const vulnerabilities: Array<{ type: string; line: number; severity: string }> = [];

    const lines = code.split('\n');

    // Check for SQL injection patterns
    lines.forEach((line, idx) => {
      if (line.includes('execute') || line.includes('query')) {
        if (line.includes('+') || line.includes('${')) {
          vulnerabilities.push({
            type: 'SQL Injection Risk',
            line: idx + 1,
            severity: 'high'
          });
        }
      }

      // Check for eval usage
      if (line.includes('eval(')) {
        vulnerabilities.push({
          type: 'Dangerous eval() usage',
          line: idx + 1,
          severity: 'critical'
        });
      }

      // Check for hardcoded secrets
      if (/(api[_-]?key|password|secret|token)\s*=\s*['"][^'"]+['"]/i.test(line)) {
        vulnerabilities.push({
          type: 'Potential hardcoded secret',
          line: idx + 1,
          severity: 'critical'
        });
      }

      // Check for XSS vulnerabilities (innerHTML, dangerouslySetInnerHTML)
      if (line.includes('innerHTML') || line.includes('dangerouslySetInnerHTML')) {
        vulnerabilities.push({
          type: 'XSS Risk',
          line: idx + 1,
          severity: 'high'
        });
      }
    });

    return {
      vulnerabilities,
      count: vulnerabilities.length,
      safe: vulnerabilities.length === 0
    };
  }
};

/**
 * Estimate performance impact
 */
export const estimatePerformanceTool = {
  id: 'estimate-performance',
  description: 'Estimate the performance characteristics of code',
  inputSchema: z.object({
    code: z.string().describe('The code to analyze'),
    language: z.string().describe('Programming language')
  }),
  execute: async ({ code, language }: { code: string; language: string }) => {
    const issues: Array<{ type: string; line: number; impact: string }> = [];
    const lines = code.split('\n');

    lines.forEach((line, idx) => {
      // Nested loops detection
      if (line.includes('for') || line.includes('while')) {
        const indentLevel = line.search(/\S/);
        if (indentLevel > 2) {
          issues.push({
            type: 'Nested loop detected - O(n²) or worse',
            line: idx + 1,
            impact: 'high'
          });
        }
      }

      // Synchronous blocking operations
      if (line.includes('.sync') || (line.includes('readFileSync') && !line.includes('await'))) {
        issues.push({
          type: 'Synchronous blocking operation',
          line: idx + 1,
          impact: 'medium'
        });
      }

      // Large array operations without optimization
      if (line.includes('.map') && line.includes('.filter')) {
        issues.push({
          type: 'Chained array operations - consider optimization',
          line: idx + 1,
          impact: 'low'
        });
      }
    });

    return {
      performanceIssues: issues,
      count: issues.length,
      overallImpact: issues.some(i => i.impact === 'high') ? 'high' :
                      issues.some(i => i.impact === 'medium') ? 'medium' : 'low'
    };
  }
};

/**
 * Check test coverage indicators
 */
export const checkTestCoverageTool = {
  id: 'check-test-coverage',
  description: 'Check if the code has associated tests',
  inputSchema: z.object({
    fileName: z.string().describe('The file being reviewed'),
    hasTestFile: z.boolean().describe('Whether a test file exists')
  }),
  execute: async ({ fileName, hasTestFile }: { fileName: string; hasTestFile: boolean }) => {
    return {
      hasTests: hasTestFile,
      testFile: hasTestFile ? fileName.replace(/\.(ts|js|tsx|jsx)$/, '.test.$1') : null,
      recommendation: hasTestFile ? 'Good - tests exist' : 'Consider adding unit tests'
    };
  }
};

export const codeAnalysisTools = {
  analyzeComplexity: analyzeComplexityTool,
  detectVulnerabilities: detectVulnerabilitiesTool,
  estimatePerformance: estimatePerformanceTool,
  checkTestCoverage: checkTestCoverageTool
};
