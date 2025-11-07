export interface ReviewContext {
  changedCode: string;
  fileName: string;
  language: string;
  similarPatterns?: string[];
  conventions?: string[];
  history?: string[];
}

export function buildReviewPrompt(context: ReviewContext): string {
  let prompt = `Review the following code changes:\n\n`;
  prompt += `File: ${context.fileName}\n`;
  prompt += `Language: ${context.language}\n\n`;
  prompt += `## Changed Code:\n\`\`\`${context.language}\n${context.changedCode}\n\`\`\`\n\n`;

  if (context.similarPatterns && context.similarPatterns.length > 0) {
    prompt += `## Similar Patterns in Codebase:\n`;
    context.similarPatterns.forEach((pattern, i) => {
      prompt += `### Example ${i + 1}:\n\`\`\`${context.language}\n${pattern}\n\`\`\`\n\n`;
    });
  }

  if (context.conventions && context.conventions.length > 0) {
    prompt += `## Repository Conventions:\n`;
    context.conventions.forEach((convention) => {
      prompt += `- ${convention}\n`;
    });
    prompt += `\n`;
  }

  if (context.history && context.history.length > 0) {
    prompt += `## Similar Past Reviews:\n`;
    context.history.forEach((review) => {
      prompt += `- ${review}\n`;
    });
    prompt += `\n`;
  }

  prompt += `Analyze this code for issues. Return a JSON array of issues with this structure:
\`\`\`json
[
  {
    "type": "bug" | "security" | "performance" | "style" | "best-practice",
    "severity": "critical" | "high" | "medium" | "low" | "info",
    "confidence": 0.0-1.0,
    "title": "Brief description",
    "description": "Detailed explanation",
    "location": {
      "line": number,
      "column": number (optional),
      "endLine": number (optional)
    },
    "suggestion": {
      "description": "How to fix",
      "code": "Fixed code snippet"
    },
    "rationale": "Why this is an issue",
    "tags": ["tag1", "tag2"]
  }
]
\`\`\`

Focus on real issues that could cause bugs, security problems, or performance issues. Avoid nitpicking about style unless it significantly impacts readability.`;

  return prompt;
}

export function buildSecurityReviewPrompt(context: ReviewContext): string {
  let prompt = `Perform a security review of the following code:\n\n`;
  prompt += `File: ${context.fileName}\n`;
  prompt += `Language: ${context.language}\n\n`;
  prompt += `\`\`\`${context.language}\n${context.changedCode}\n\`\`\`\n\n`;

  prompt += `Check for:
1. SQL injection vulnerabilities
2. XSS (Cross-Site Scripting) vulnerabilities
3. Authentication/authorization issues
4. Hardcoded secrets or credentials
5. Insecure cryptography
6. Path traversal vulnerabilities
7. Command injection
8. Insecure deserialization
9. Insufficient input validation
10. Missing security headers

Return findings in JSON format as specified in the general review prompt.`;

  return prompt;
}

export function buildPerformanceReviewPrompt(context: ReviewContext): string {
  let prompt = `Analyze the following code for performance issues:\n\n`;
  prompt += `File: ${context.fileName}\n`;
  prompt += `Language: ${context.language}\n\n`;
  prompt += `\`\`\`${context.language}\n${context.changedCode}\n\`\`\`\n\n`;

  prompt += `Check for:
1. Algorithmic complexity issues (O(n²) or worse)
2. Unnecessary loops or iterations
3. Memory leaks or excessive memory usage
4. Database query inefficiencies (N+1 problem)
5. Synchronous operations that could be async
6. Missing caching opportunities
7. Excessive network requests
8. Large data structure copies
9. Inefficient string concatenation
10. Regex performance issues

For each issue, provide:
- Current complexity
- Expected impact
- Optimized approach
- Estimated performance gain

Return findings in JSON format.`;

  return prompt;
}

export function buildLogicReviewPrompt(context: ReviewContext): string {
  let prompt = `Analyze the following code for logic bugs and edge cases:\n\n`;
  prompt += `File: ${context.fileName}\n`;
  prompt += `Language: ${context.language}\n\n`;
  prompt += `\`\`\`${context.language}\n${context.changedCode}\n\`\`\`\n\n`;

  prompt += `Check for:
1. Null/undefined handling issues
2. Off-by-one errors
3. Incorrect conditional logic
4. Race conditions
5. Missing error handling
6. Edge cases (empty arrays, zero/negative numbers, boundary conditions)
7. Type coercion problems
8. Async/await mistakes
9. Unhandled promise rejections
10. Infinite loops or recursion

For each bug:
- Explain the logic error
- Show which inputs would trigger it
- Provide a corrected version

Return findings in JSON format.`;

  return prompt;
}

export function buildExplanationPrompt(code: string, language: string): string {
  return `Explain the following ${language} code in clear, simple terms:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nProvide:
1. High-level overview (what does this code do?)
2. Step-by-step breakdown
3. Key concepts or patterns used
4. Any potential concerns or improvements

Keep the explanation concise but thorough.`;
}

export function buildSuggestionPrompt(
  description: string,
  context: ReviewContext
): string {
  let prompt = `Generate an implementation for: "${description}"\n\n`;
  prompt += `Context:\n`;
  prompt += `File: ${context.fileName}\n`;
  prompt += `Language: ${context.language}\n\n`;

  if (context.similarPatterns && context.similarPatterns.length > 0) {
    prompt += `Similar code patterns in the repository:\n`;
    context.similarPatterns.forEach((pattern, i) => {
      prompt += `\n### Example ${i + 1}:\n\`\`\`${context.language}\n${pattern}\n\`\`\`\n`;
    });
    prompt += `\n`;
  }

  if (context.conventions && context.conventions.length > 0) {
    prompt += `Follow these repository conventions:\n`;
    context.conventions.forEach((convention) => {
      prompt += `- ${convention}\n`;
    });
    prompt += `\n`;
  }

  prompt += `Provide:
1. A clear explanation of the approach
2. Complete, working code implementation
3. Usage example
4. Any important considerations or edge cases

Format the response as JSON:
\`\`\`json
{
  "description": "Explanation of the implementation",
  "code": "Complete code",
  "usage": "Example usage",
  "considerations": ["Important note 1", "Important note 2"]
}
\`\`\``;

  return prompt;
}
