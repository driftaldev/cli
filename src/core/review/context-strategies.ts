/**
 * Agent-specific context strategies
 * Each agent gets specialized context relevant to its analysis type
 */

import { RankedItem, RelevanceRanker } from "./relevance-ranker";
import { logger } from "../../utils/logger.js";

export interface EnrichedContext {
  // Original file info
  fileName: string;
  changedCode: string;
  language: string;
  fullContent?: string;

  // Import context
  imports?: Array<{
    importPath: string;
    importedNames: string[];
    resolvedPath: string;
    definition: string;
    relevance?: number;
  }>;

  // Type definitions
  typeDefinitions?: Array<{
    name: string;
    definition: string;
    source: string;
    relevance?: number;
  }>;

  // Similar patterns
  similarPatterns?: Array<{
    filePath: string;
    code: string;
    similarity: number;
    relevance?: number;
  }>;

  // Dependencies
  dependencies?: {
    upstream: Array<{
      filePath: string;
      depth: number;
      exports: string[];
      content?: string; // Full file content for depth 1 dependencies
      relevantDefinitions?: string; // Extracted function/class signatures
    }>;
    downstream: Array<{
      filePath: string;
      depth: number;
    }>;
  };

  // Tests
  relatedTests?: Array<{
    filePath: string;
    testNames: string[];
    relevance?: number;
  }>;

  // Documentation
  documentation?: Array<{
    source: string;
    content: string;
  }>;
}

export interface ContextStrategy {
  name: string;
  selectContext(
    context: EnrichedContext,
    ranker: RelevanceRanker
  ): EnrichedContext;
  formatPrompt(context: EnrichedContext): string;
}

/**
 * Security Agent Context Strategy
 * Focus: imports, type definitions, security-related patterns
 */
export class SecurityContextStrategy implements ContextStrategy {
  name = "security";

  selectContext(
    context: EnrichedContext,
    ranker: RelevanceRanker
  ): EnrichedContext {
    // Select top imports (security-relevant ones)
    const rankedImports = context.imports
      ? ranker.rankImports(
          context.imports.map((imp) => ({
            importPath: imp.importPath,
            content: imp.definition,
            usageCount: this.countUsages(
              context.changedCode,
              imp.importedNames
            ),
          })),
          context.changedCode,
          {
            maxItems: 5,
            priorityKeywords: ["auth", "crypto", "security", "hash", "token"],
          }
        )
      : [];

    if (context.imports && context.imports.length > 0) {
      logger.debug(
        `[SecurityStrategy] Import filtering: ${context.imports.length} → ${rankedImports.length}`
      );
      rankedImports.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.importPath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Select security-relevant type definitions
    const rankedTypes = context.typeDefinitions
      ? ranker.rankTypeDefinitions(
          context.typeDefinitions,
          context.changedCode,
          { maxItems: 5 }
        )
      : [];

    if (context.typeDefinitions && context.typeDefinitions.length > 0) {
      logger.debug(
        `[SecurityStrategy] Type filtering: ${context.typeDefinitions.length} → ${rankedTypes.length}`
      );
      rankedTypes.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.name} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Select security patterns from similar code
    const rankedPatterns = context.similarPatterns
      ? ranker.rankSimilarPatterns(
          context.similarPatterns,
          context.changedCode,
          { maxItems: 3, priorityKeywords: [context.fileName] }
        )
      : [];

    if (context.similarPatterns && context.similarPatterns.length > 0) {
      logger.debug(
        `[SecurityStrategy] Pattern filtering: ${context.similarPatterns.length} → ${rankedPatterns.length}`
      );
      rankedPatterns.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.filePath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    logger.debug(
      `[SecurityStrategy] Dependencies: keeping top 3/${context.dependencies?.upstream.length || 0} upstream, 0 downstream`
    );

    return {
      fileName: context.fileName,
      changedCode: context.changedCode,
      language: context.language,
      fullContent: context.fullContent,
      imports: this.mapRankedToImports(rankedImports, context.imports || []),
      typeDefinitions: this.mapRankedToTypes(
        rankedTypes,
        context.typeDefinitions || []
      ),
      similarPatterns: this.mapRankedToPatterns(
        rankedPatterns,
        context.similarPatterns || []
      ),
      dependencies: {
        upstream: context.dependencies?.upstream.slice(0, 3) || [],
        downstream: [],
      },
    };
  }

  formatPrompt(context: EnrichedContext): string {
    let prompt = `Analyze the following code for security vulnerabilities:

## File: ${context.fileName}
Language: ${context.language}

## Changed Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`
`;

    // Add imports section (full content, no truncation)
    if (context.imports && context.imports.length > 0) {
      prompt += "\n## Imported Dependencies:\n";
      context.imports.forEach((imp) => {
        prompt += `\n### ${imp.importPath}\n`;
        prompt += `Imports: ${imp.importedNames.join(", ")}\n`;
        if (imp.definition) {
          prompt += `\`\`\`${context.language}\n${imp.definition}\n\`\`\`\n`;
        }
      });
    }

    // Add type definitions
    if (context.typeDefinitions && context.typeDefinitions.length > 0) {
      prompt += "\n## Type Definitions:\n";
      context.typeDefinitions.forEach((type) => {
        prompt += `\n### ${type.name} (from ${type.source})\n`;
        prompt += `\`\`\`${context.language}\n${type.definition}\n\`\`\`\n`;
      });
    }

    // Add similar patterns
    if (context.similarPatterns && context.similarPatterns.length > 0) {
      prompt += "\n## Similar Patterns in Codebase:\n";
      context.similarPatterns.forEach((pattern, idx) => {
        prompt += `\n### Pattern ${idx + 1} from ${pattern.filePath}\n`;
        prompt += `\`\`\`${context.language}\n${this.truncate(pattern.code, 400)}\n\`\`\`\n`;
      });
    }

    // Add upstream dependencies with full content for depth 1
    if (
      context.dependencies?.upstream &&
      context.dependencies.upstream.length > 0
    ) {
      prompt += "\n## Upstream Dependencies (Full Files):\n";
      context.dependencies.upstream.forEach((dep) => {
        if (dep.depth === 1 && dep.content) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth})\n`;
          prompt += `\`\`\`${context.language}\n${dep.content}\n\`\`\`\n`;
        } else if (dep.relevantDefinitions) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth}) - Key Signatures\n`;
          prompt += `\`\`\`${context.language}\n${dep.relevantDefinitions}\n\`\`\`\n`;
        }
      });
    }

    prompt += "\nScan for common security issues such as:\n";
    prompt += "- SQL injection, XSS, command injection\n";
    prompt += "- Authentication/authorization bypass\n";
    prompt += "- Insecure data handling (secrets, sensitive data)\n";
    prompt += "- Cryptographic weaknesses\n";
    prompt += "- Input validation issues\n";

    return prompt;
  }

  private countUsages(code: string, names: string[]): number {
    return names.reduce((count, name) => {
      const regex = new RegExp(`\\b${name}\\b`, "g");
      return count + (code.match(regex) || []).length;
    }, 0);
  }

  private truncate(text: string, maxLength: number): string {
    return text.length > maxLength
      ? text.slice(0, maxLength) + "\n// ... truncated ..."
      : text;
  }

  private mapRankedToImports(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find(
          (o) => o.importPath === r.metadata?.importPath
        );
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToTypes(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.name === r.metadata?.name);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToPatterns(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.filePath === r.metadata?.filePath);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }
}

/**
 * Performance Agent Context Strategy
 * Focus: similar patterns, function complexity, usage frequency
 */
export class PerformanceContextStrategy implements ContextStrategy {
  name = "performance";

  selectContext(
    context: EnrichedContext,
    ranker: RelevanceRanker
  ): EnrichedContext {
    // Select imports that might impact performance
    const rankedImports = context.imports
      ? ranker.rankImports(
          context.imports.map((imp) => ({
            importPath: imp.importPath,
            content: imp.definition,
          })),
          context.changedCode,
          { maxItems: 3 }
        )
      : [];

    if (context.imports && context.imports.length > 0) {
      logger.debug(
        `[PerformanceStrategy] Import filtering: ${context.imports.length} → ${rankedImports.length}`
      );
      rankedImports.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.importPath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Focus heavily on similar patterns for performance comparison
    const rankedPatterns = context.similarPatterns
      ? ranker.rankSimilarPatterns(
          context.similarPatterns,
          context.changedCode,
          { maxItems: 5, priorityKeywords: [context.fileName] }
        )
      : [];

    if (context.similarPatterns && context.similarPatterns.length > 0) {
      logger.debug(
        `[PerformanceStrategy] Pattern filtering: ${context.similarPatterns.length} → ${rankedPatterns.length}`
      );
      rankedPatterns.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.filePath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    logger.debug(
      `[PerformanceStrategy] Dependencies: keeping top 5/${context.dependencies?.upstream.length || 0} upstream, ` +
        `top 3/${context.dependencies?.downstream.length || 0} downstream`
    );

    return {
      fileName: context.fileName,
      changedCode: context.changedCode,
      language: context.language,
      fullContent: context.fullContent,
      imports: this.mapRankedToImports(rankedImports, context.imports || []),
      similarPatterns: this.mapRankedToPatterns(
        rankedPatterns,
        context.similarPatterns || []
      ),
      dependencies: {
        upstream: context.dependencies?.upstream.slice(0, 5) || [],
        downstream: context.dependencies?.downstream.slice(0, 3) || [],
      },
    };
  }

  formatPrompt(context: EnrichedContext): string {
    let prompt = `Analyze the following code for performance issues:

## File: ${context.fileName}
Language: ${context.language}

## Changed Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`
`;

    // Add similar patterns (key for performance comparison)
    if (context.similarPatterns && context.similarPatterns.length > 0) {
      prompt += "\n## Similar Patterns in Codebase:\n";
      prompt += "Compare the changed code against these existing patterns:\n\n";
      context.similarPatterns.forEach((pattern, idx) => {
        prompt += `\n### Pattern ${idx + 1} from ${pattern.filePath} (${(pattern.similarity * 100).toFixed(0)}% similar)\n`;
        prompt += `\`\`\`${context.language}\n${this.truncate(pattern.code, 500)}\n\`\`\`\n`;
      });
    }

    // Add upstream dependencies with full content for depth 1
    if (
      context.dependencies?.upstream &&
      context.dependencies.upstream.length > 0
    ) {
      prompt += "\n## Upstream Dependencies (Full Files):\n";
      context.dependencies.upstream.forEach((dep) => {
        if (dep.depth === 1 && dep.content) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth})\n`;
          prompt += `\`\`\`${context.language}\n${dep.content}\n\`\`\`\n`;
        } else if (dep.relevantDefinitions) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth}) - Key Signatures\n`;
          prompt += `\`\`\`${context.language}\n${dep.relevantDefinitions}\n\`\`\`\n`;
        } else {
          prompt += `- ${dep.filePath} (depth ${dep.depth})\n`;
        }
      });
    }

    // Add downstream dependencies
    if (
      context.dependencies?.downstream &&
      context.dependencies.downstream.length > 0
    ) {
      prompt += "\n## Used By (impact scope):\n";
      context.dependencies.downstream.forEach((dep) => {
        prompt += `- ${dep.filePath}\n`;
      });
    }

    // Add relevant imports (full content, no truncation)
    if (context.imports && context.imports.length > 0) {
      prompt += "\n## Key Imports:\n";
      context.imports.forEach((imp) => {
        prompt += `\n### ${imp.importPath}\n`;
        prompt += `Imports: ${imp.importedNames.join(", ")}\n`;
        if (imp.definition) {
          prompt += `\`\`\`${context.language}\n${imp.definition}\n\`\`\`\n`;
        }
      });
    }

    prompt += "\nAnalyze:\n";
    prompt += "- Time complexity (loops, recursion, nested operations)\n";
    prompt += "- Memory usage patterns\n";
    prompt += "- Unnecessary computations or allocations\n";
    prompt += "- Database query efficiency\n";
    prompt += "- Async/await patterns\n";

    return prompt;
  }

  private truncate(text: string, maxLength: number): string {
    return text.length > maxLength
      ? text.slice(0, maxLength) + "\n// ... truncated ..."
      : text;
  }

  private mapRankedToImports(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find(
          (o) => o.importPath === r.metadata?.importPath
        );
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToPatterns(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.filePath === r.metadata?.filePath);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }
}

/**
 * Logic Agent Context Strategy
 * Focus: tests, dependencies, type definitions, related code
 */
export class LogicContextStrategy implements ContextStrategy {
  name = "logic";

  selectContext(
    context: EnrichedContext,
    ranker: RelevanceRanker
  ): EnrichedContext {
    // Select all relevant imports
    const rankedImports = context.imports
      ? ranker.rankImports(
          context.imports.map((imp) => ({
            importPath: imp.importPath,
            content: imp.definition,
            usageCount: this.countUsages(
              context.changedCode,
              imp.importedNames
            ),
          })),
          context.changedCode,
          { maxItems: 5 }
        )
      : [];

    if (context.imports && context.imports.length > 0) {
      logger.debug(
        `[LogicStrategy] Import filtering: ${context.imports.length} → ${rankedImports.length}`
      );
      rankedImports.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.importPath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Type definitions are critical for logic analysis
    const rankedTypes = context.typeDefinitions
      ? ranker.rankTypeDefinitions(
          context.typeDefinitions,
          context.changedCode,
          { maxItems: 7 }
        )
      : [];

    if (context.typeDefinitions && context.typeDefinitions.length > 0) {
      logger.debug(
        `[LogicStrategy] Type filtering: ${context.typeDefinitions.length} → ${rankedTypes.length}`
      );
      rankedTypes.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.name} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Tests are crucial
    const rankedTests = context.relatedTests
      ? ranker.rankTests(
          context.relatedTests.map((test) => ({
            filePath: test.filePath,
            tests: test.testNames,
          })),
          context.fileName,
          { maxItems: 3 }
        )
      : [];

    if (context.relatedTests && context.relatedTests.length > 0) {
      logger.debug(
        `[LogicStrategy] Test filtering: ${context.relatedTests.length} → ${rankedTests.length}`
      );
      rankedTests.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.filePath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Similar patterns for logic consistency
    const rankedPatterns = context.similarPatterns
      ? ranker.rankSimilarPatterns(
          context.similarPatterns,
          context.changedCode,
          { maxItems: 3, priorityKeywords: [context.fileName] }
        )
      : [];

    if (context.similarPatterns && context.similarPatterns.length > 0) {
      logger.debug(
        `[LogicStrategy] Pattern filtering: ${context.similarPatterns.length} → ${rankedPatterns.length}`
      );
      rankedPatterns.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.filePath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    logger.debug(
      `[LogicStrategy] Dependencies: keeping all dependencies (no filtering)`
    );

    return {
      fileName: context.fileName,
      changedCode: context.changedCode,
      language: context.language,
      fullContent: context.fullContent,
      imports: this.mapRankedToImports(rankedImports, context.imports || []),
      typeDefinitions: this.mapRankedToTypes(
        rankedTypes,
        context.typeDefinitions || []
      ),
      similarPatterns: this.mapRankedToPatterns(
        rankedPatterns,
        context.similarPatterns || []
      ),
      relatedTests: this.mapRankedToTests(
        rankedTests,
        context.relatedTests || []
      ),
      dependencies: context.dependencies,
    };
  }

  formatPrompt(context: EnrichedContext): string {
    let prompt = `Analyze the following code for logic issues and correctness:

## File: ${context.fileName}
Language: ${context.language}

## Changed Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`
`;

    // Add type definitions (critical for logic)
    if (context.typeDefinitions && context.typeDefinitions.length > 0) {
      prompt += "\n## Type Definitions:\n";
      context.typeDefinitions.forEach((type) => {
        prompt += `\n### ${type.name} (from ${type.source})\n`;
        prompt += `\`\`\`${context.language}\n${type.definition}\n\`\`\`\n`;
      });
    }

    // Add related tests
    if (context.relatedTests && context.relatedTests.length > 0) {
      prompt += "\n## Related Tests:\n";
      context.relatedTests.forEach((test) => {
        prompt += `\n### ${test.filePath}\n`;
        if (test.testNames.length > 0) {
          prompt += "Test cases:\n";
          test.testNames.slice(0, 10).forEach((name) => {
            prompt += `- ${name}\n`;
          });
          if (test.testNames.length > 10) {
            prompt += `... and ${test.testNames.length - 10} more\n`;
          }
        }
      });
    }

    // Add imports (full content, no truncation)
    if (context.imports && context.imports.length > 0) {
      prompt += "\n## Imported Dependencies:\n";
      context.imports.forEach((imp) => {
        prompt += `\n### ${imp.importPath}\n`;
        prompt += `Imports: ${imp.importedNames.join(", ")}\n`;
        if (imp.definition) {
          prompt += `\`\`\`${context.language}\n${imp.definition}\n\`\`\`\n`;
        }
      });
    }

    // Add upstream dependencies with full content for depth 1
    if (
      context.dependencies?.upstream &&
      context.dependencies.upstream.length > 0
    ) {
      prompt += "\n## Upstream Dependencies (Full Files):\n";
      context.dependencies.upstream.forEach((dep) => {
        if (dep.depth === 1 && dep.content) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth})\n`;
          prompt += `\`\`\`${context.language}\n${dep.content}\n\`\`\`\n`;
        } else if (dep.relevantDefinitions) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth}) - Key Signatures\n`;
          prompt += `\`\`\`${context.language}\n${dep.relevantDefinitions}\n\`\`\`\n`;
        } else {
          prompt += `- ${dep.filePath}\n`;
          if (dep.exports.length > 0) {
            prompt += `  Exports: ${dep.exports.slice(0, 5).join(", ")}\n`;
          }
        }
      });
    }

    // Add downstream dependencies
    if (
      context.dependencies?.downstream &&
      context.dependencies.downstream.length > 0
    ) {
      prompt += "\n## Used By:\n";
      context.dependencies.downstream.slice(0, 3).forEach((dep) => {
        prompt += `- ${dep.filePath}\n`;
      });
    }

    // Add similar patterns
    if (context.similarPatterns && context.similarPatterns.length > 0) {
      prompt += "\n## Similar Code Patterns:\n";
      context.similarPatterns.forEach((pattern, idx) => {
        prompt += `\n### Pattern ${idx + 1} from ${pattern.filePath}\n`;
        prompt += `\`\`\`${context.language}\n${this.truncate(pattern.code, 300)}\n\`\`\`\n`;
      });
    }

    prompt += "\nAnalyze for:\n";
    prompt += "- Logic errors and edge cases\n";
    prompt += "- Type safety and null handling\n";
    prompt += "- Error handling completeness\n";
    prompt += "- Consistency with existing patterns\n";
    prompt += "- Test coverage gaps\n";
    prompt += "- Potential runtime errors\n";

    return prompt;
  }

  private countUsages(code: string, names: string[]): number {
    return names.reduce((count, name) => {
      const regex = new RegExp(`\\b${name}\\b`, "g");
      return count + (code.match(regex) || []).length;
    }, 0);
  }

  private truncate(text: string, maxLength: number): string {
    return text.length > maxLength
      ? text.slice(0, maxLength) + "\n// ... truncated ..."
      : text;
  }

  private mapRankedToImports(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find(
          (o) => o.importPath === r.metadata?.importPath
        );
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToTypes(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.name === r.metadata?.name);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToPatterns(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.filePath === r.metadata?.filePath);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToTests(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.filePath === r.metadata?.filePath);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }
}

/**
 * Code Analyzer Context Strategy
 * Combines logic and security analysis priorities
 * Focus: comprehensive analysis of logic bugs and security vulnerabilities
 */
export class CodeContextStrategy implements ContextStrategy {
  name = "code";

  selectContext(
    context: EnrichedContext,
    ranker: RelevanceRanker
  ): EnrichedContext {
    // Select imports relevant to both logic and security
    const rankedImports = context.imports
      ? ranker.rankImports(
          context.imports.map((imp) => ({
            importPath: imp.importPath,
            content: imp.definition,
            usageCount: this.countUsages(
              context.changedCode,
              imp.importedNames
            ),
          })),
          context.changedCode,
          {
            maxItems: 7,
            // Combined priority keywords for both security and logic
            priorityKeywords: [
              "auth",
              "crypto",
              "security",
              "hash",
              "token",
              "validate",
              "sanitize",
            ],
          }
        )
      : [];

    if (context.imports && context.imports.length > 0) {
      logger.debug(
        `[CodeStrategy] Import filtering: ${context.imports.length} → ${rankedImports.length}`
      );
      rankedImports.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.importPath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Type definitions are critical for both logic and security analysis
    const rankedTypes = context.typeDefinitions
      ? ranker.rankTypeDefinitions(
          context.typeDefinitions,
          context.changedCode,
          { maxItems: 7 }
        )
      : [];

    if (context.typeDefinitions && context.typeDefinitions.length > 0) {
      logger.debug(
        `[CodeStrategy] Type filtering: ${context.typeDefinitions.length} → ${rankedTypes.length}`
      );
      rankedTypes.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.name} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Tests are crucial for understanding expected behavior
    const rankedTests = context.relatedTests
      ? ranker.rankTests(
          context.relatedTests.map((test) => ({
            filePath: test.filePath,
            tests: test.testNames,
          })),
          context.fileName,
          { maxItems: 3 }
        )
      : [];

    if (context.relatedTests && context.relatedTests.length > 0) {
      logger.debug(
        `[CodeStrategy] Test filtering: ${context.relatedTests.length} → ${rankedTests.length}`
      );
      rankedTests.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.filePath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    // Similar patterns for consistency checking
    const rankedPatterns = context.similarPatterns
      ? ranker.rankSimilarPatterns(
          context.similarPatterns,
          context.changedCode,
          { maxItems: 5, priorityKeywords: [context.fileName] }
        )
      : [];

    if (context.similarPatterns && context.similarPatterns.length > 0) {
      logger.debug(
        `[CodeStrategy] Pattern filtering: ${context.similarPatterns.length} → ${rankedPatterns.length}`
      );
      rankedPatterns.forEach((item, idx) => {
        logger.debug(
          `  ${idx + 1}. ${item.metadata?.filePath} (score: ${item.score.toFixed(2)}, ${item.reason})`
        );
      });
    }

    logger.debug(
      `[CodeStrategy] Dependencies: keeping all dependencies (no filtering)`
    );

    return {
      fileName: context.fileName,
      changedCode: context.changedCode,
      language: context.language,
      fullContent: context.fullContent,
      imports: this.mapRankedToImports(rankedImports, context.imports || []),
      typeDefinitions: this.mapRankedToTypes(
        rankedTypes,
        context.typeDefinitions || []
      ),
      similarPatterns: this.mapRankedToPatterns(
        rankedPatterns,
        context.similarPatterns || []
      ),
      relatedTests: this.mapRankedToTests(
        rankedTests,
        context.relatedTests || []
      ),
      dependencies: context.dependencies,
    };
  }

  formatPrompt(context: EnrichedContext): string {
    let prompt = `Analyze the following code for logic bugs, security vulnerabilities, and edge cases:

## File: ${context.fileName}
Language: ${context.language}

## Changed Code:
\`\`\`${context.language}
${context.changedCode}
\`\`\`
`;

    // Add type definitions (critical for both logic and security)
    if (context.typeDefinitions && context.typeDefinitions.length > 0) {
      prompt += "\n## Type Definitions:\n";
      context.typeDefinitions.forEach((type) => {
        prompt += `\n### ${type.name} (from ${type.source})\n`;
        prompt += `\`\`\`${context.language}\n${type.definition}\n\`\`\`\n`;
      });
    }

    // Add related tests
    if (context.relatedTests && context.relatedTests.length > 0) {
      prompt += "\n## Related Tests:\n";
      context.relatedTests.forEach((test) => {
        prompt += `\n### ${test.filePath}\n`;
        if (test.testNames.length > 0) {
          prompt += "Test cases:\n";
          test.testNames.slice(0, 10).forEach((name) => {
            prompt += `- ${name}\n`;
          });
          if (test.testNames.length > 10) {
            prompt += `... and ${test.testNames.length - 10} more\n`;
          }
        }
      });
    }

    // Add imports (full content, no truncation)
    if (context.imports && context.imports.length > 0) {
      prompt += "\n## Imported Dependencies:\n";
      context.imports.forEach((imp) => {
        prompt += `\n### ${imp.importPath}\n`;
        prompt += `Imports: ${imp.importedNames.join(", ")}\n`;
        if (imp.definition) {
          prompt += `\`\`\`${context.language}\n${imp.definition}\n\`\`\`\n`;
        }
      });
    }

    // Add upstream dependencies with full content for depth 1
    if (
      context.dependencies?.upstream &&
      context.dependencies.upstream.length > 0
    ) {
      prompt += "\n## Upstream Dependencies (Full Files):\n";
      context.dependencies.upstream.forEach((dep) => {
        if (dep.depth === 1 && dep.content) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth})\n`;
          prompt += `\`\`\`${context.language}\n${dep.content}\n\`\`\`\n`;
        } else if (dep.relevantDefinitions) {
          prompt += `\n### ${dep.filePath} (depth ${dep.depth}) - Key Signatures\n`;
          prompt += `\`\`\`${context.language}\n${dep.relevantDefinitions}\n\`\`\`\n`;
        } else {
          prompt += `- ${dep.filePath}\n`;
          if (dep.exports.length > 0) {
            prompt += `  Exports: ${dep.exports.slice(0, 5).join(", ")}\n`;
          }
        }
      });
    }

    // Add downstream dependencies
    if (
      context.dependencies?.downstream &&
      context.dependencies.downstream.length > 0
    ) {
      prompt += "\n## Used By:\n";
      context.dependencies.downstream.slice(0, 3).forEach((dep) => {
        prompt += `- ${dep.filePath}\n`;
      });
    }

    // Add similar patterns
    if (context.similarPatterns && context.similarPatterns.length > 0) {
      prompt += "\n## Similar Code Patterns:\n";
      context.similarPatterns.forEach((pattern, idx) => {
        prompt += `\n### Pattern ${idx + 1} from ${pattern.filePath}\n`;
        prompt += `\`\`\`${context.language}\n${this.truncate(pattern.code, 300)}\n\`\`\`\n`;
      });
    }

    prompt += "\nAnalyze for:\n";
    prompt += "- Logic errors and edge cases\n";
    prompt += "- Type safety and null handling\n";
    prompt += "- Error handling completeness\n";
    prompt += "- Security vulnerabilities (injection, XSS, auth bypass, sensitive data exposure)\n";
    prompt += "- Cryptographic weaknesses and input validation issues\n";
    prompt += "- Consistency with existing patterns\n";
    prompt += "- Test coverage gaps\n";
    prompt += "- Potential runtime errors\n";

    return prompt;
  }

  private countUsages(code: string, names: string[]): number {
    return names.reduce((count, name) => {
      const regex = new RegExp(`\\b${name}\\b`, "g");
      return count + (code.match(regex) || []).length;
    }, 0);
  }

  private truncate(text: string, maxLength: number): string {
    return text.length > maxLength
      ? text.slice(0, maxLength) + "\n// ... truncated ..."
      : text;
  }

  private mapRankedToImports(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find(
          (o) => o.importPath === r.metadata?.importPath
        );
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToTypes(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.name === r.metadata?.name);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToPatterns(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.filePath === r.metadata?.filePath);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }

  private mapRankedToTests(ranked: RankedItem[], original: any[]): any[] {
    return ranked
      .map((r) => {
        const orig = original.find((o) => o.filePath === r.metadata?.filePath);
        return orig ? { ...orig, relevance: r.score } : null;
      })
      .filter(Boolean);
  }
}

/**
 * Strategy factory
 */
export class ContextStrategyFactory {
  private static strategies = new Map<string, ContextStrategy>([
    ["security", new SecurityContextStrategy()],
    ["performance", new PerformanceContextStrategy()],
    ["logic", new LogicContextStrategy()],
    ["code", new CodeContextStrategy()],
  ]);

  static getStrategy(agentType: string): ContextStrategy {
    const strategy = this.strategies.get(agentType);
    if (!strategy) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }
    return strategy;
  }

  static getAllStrategies(): ContextStrategy[] {
    return Array.from(this.strategies.values());
  }
}
