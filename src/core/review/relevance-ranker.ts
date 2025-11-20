/**
 * Smart relevance ranking for context items
 * Ranks context by importance to avoid token bloat
 */

import { findTypeReferences, isTypeExported } from "../../utils/ast-helpers.js";

export interface RankableItem {
  content: string;
  metadata?: Record<string, any>;
}

export interface RankedItem extends RankableItem {
  score: number;
  reason: string;
}

export interface RankingOptions {
  maxItems?: number;
  minScore?: number;
  priorityKeywords?: string[];
}

/**
 * Ranks items by relevance based on multiple signals
 */
export class RelevanceRanker {
  /**
   * Rank import definitions by relevance to the changed code
   */
  rankImports(
    imports: Array<{ importPath: string; content: string; usageCount?: number }>,
    changedCode: string,
    options: RankingOptions = {}
  ): RankedItem[] {
    const { maxItems = 5, minScore = 0.3 } = options;

    const ranked = imports.map((imp) => {
      let score = 0;
      const reasons: string[] = [];

      // Score by usage frequency in changed code
      const usageMatches = this.countMatches(changedCode, imp.importPath.split('/').pop() || '');
      if (usageMatches > 0) {
        score += Math.min(usageMatches * 0.2, 0.6);
        reasons.push(`used ${usageMatches} times`);
      }

      // Score by direct mentions in changed code
      const directMentions = imp.usageCount || 0;
      if (directMentions > 0) {
        score += Math.min(directMentions * 0.15, 0.4);
        reasons.push(`${directMentions} direct references`);
      }

      // Boost for common critical imports
      const criticalPatterns = ['config', 'schema', 'type', 'interface', 'model', 'api'];
      if (criticalPatterns.some((pattern) => imp.importPath.toLowerCase().includes(pattern))) {
        score += 0.3;
        reasons.push('critical import');
      }

      // Boost for recently modified imports (if metadata available)
      if (imp.usageCount && imp.usageCount > 3) {
        score += 0.2;
        reasons.push('heavily used');
      }

      return {
        content: imp.content,
        metadata: { importPath: imp.importPath },
        score: Math.min(score, 1.0),
        reason: reasons.join(', '),
      };
    });

    return ranked
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }

  /**
   * Rank similar code patterns by relevance
   */
  rankSimilarPatterns(
    patterns: Array<{
      filePath: string;
      code: string;
      similarity: number;
      matchedConcepts?: string[];
    }>,
    changedCode: string,
    options: RankingOptions = {}
  ): RankedItem[] {
    const { maxItems = 3, minScore = 0.4 } = options;

    const ranked = patterns.map((pattern) => {
      let score = pattern.similarity;
      const reasons: string[] = [`${(pattern.similarity * 100).toFixed(0)}% similar`];

      // Boost if from related directory
      const changedFilePath = options.priorityKeywords?.[0] || '';
      if (changedFilePath && this.areRelatedPaths(changedFilePath, pattern.filePath)) {
        score += 0.2;
        reasons.push('related location');
      }

      // Boost if has matching concepts
      if (pattern.matchedConcepts && pattern.matchedConcepts.length > 0) {
        score += pattern.matchedConcepts.length * 0.1;
        reasons.push(`${pattern.matchedConcepts.length} matching concepts`);
      }

      // Penalize very similar patterns (might be duplicates)
      if (pattern.similarity > 0.95) {
        score *= 0.7;
        reasons.push('potential duplicate');
      }

      return {
        content: pattern.code,
        metadata: { filePath: pattern.filePath, similarity: pattern.similarity },
        score: Math.min(score, 1.0),
        reason: reasons.join(', '),
      };
    });

    return ranked
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }

  /**
   * Rank type definitions by relevance
   */
  rankTypeDefinitions(
    types: Array<{ name: string; definition: string; source: string; usageCount?: number }>,
    changedCode: string,
    options: RankingOptions = {}
  ): RankedItem[] {
    const { maxItems = 5, minScore = 0.3 } = options;

    const ranked = types.map((type) => {
      let score = 0;
      const reasons: string[] = [];

      // Score by usage in changed code
      const usageMatches = this.countMatches(changedCode, type.name);
      if (usageMatches > 0) {
        score += Math.min(usageMatches * 0.25, 0.7);
        reasons.push(`used ${usageMatches} times`);
      }

      // Use AST-based type reference detection instead of string matching
      try {
        const typeRefs = findTypeReferences(changedCode, type.name);
        if (typeRefs.length > 0) {
          score += 0.4;
          reasons.push(`type annotation (${typeRefs.length} refs)`);
        }
      } catch (error) {
        // Fall back to simple string matching if AST parsing fails
        if (changedCode.includes(`: ${type.name}`) || changedCode.includes(`<${type.name}>`)) {
          score += 0.4;
          reasons.push('type annotation');
        }
      }

      // Use AST-based export detection instead of string matching
      try {
        if (isTypeExported(type.definition, type.name)) {
          score += 0.2;
          reasons.push('exported type');
        }
      } catch (error) {
        // Fall back to simple string matching if AST parsing fails
        if (type.definition.includes('export')) {
          score += 0.2;
          reasons.push('exported type');
        }
      }

      // Boost based on global usage count
      if (type.usageCount && type.usageCount > 5) {
        score += 0.2;
        reasons.push('widely used');
      }

      return {
        content: type.definition,
        metadata: { name: type.name, source: type.source },
        score: Math.min(score, 1.0),
        reason: reasons.join(', '),
      };
    });

    return ranked
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }

  /**
   * Rank related test files by relevance
   */
  rankTests(
    tests: Array<{ filePath: string; tests: string[]; coverage?: number }>,
    fileUnderReview: string,
    options: RankingOptions = {}
  ): RankedItem[] {
    const { maxItems = 3, minScore = 0.3 } = options;

    const ranked = tests.map((test) => {
      let score = 0;
      const reasons: string[] = [];

      // Score by path similarity
      if (this.areRelatedPaths(fileUnderReview, test.filePath)) {
        score += 0.5;
        reasons.push('matching path');
      }

      // Score by number of tests
      if (test.tests.length > 0) {
        score += Math.min(test.tests.length * 0.1, 0.3);
        reasons.push(`${test.tests.length} tests`);
      }

      // Boost for high coverage
      if (test.coverage && test.coverage > 70) {
        score += 0.3;
        reasons.push(`${test.coverage}% coverage`);
      }

      return {
        content: test.tests.join('\n'),
        metadata: { filePath: test.filePath, testCount: test.tests.length },
        score: Math.min(score, 1.0),
        reason: reasons.join(', '),
      };
    });

    return ranked
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }

  /**
   * Rank dependency relationships by relevance
   */
  rankDependencies(
    deps: Array<{ filePath: string; relationship: 'upstream' | 'downstream'; depth: number }>,
    options: RankingOptions = {}
  ): RankedItem[] {
    const { maxItems = 5, minScore = 0.3 } = options;

    const ranked = deps.map((dep) => {
      let score = 1.0;
      const reasons: string[] = [];

      // Penalize by depth (closer is better)
      score -= dep.depth * 0.2;
      reasons.push(`depth ${dep.depth}`);

      // Boost upstream over downstream (what we depend on is more critical)
      if (dep.relationship === 'upstream') {
        score += 0.2;
        reasons.push('direct dependency');
      } else {
        reasons.push('dependent');
      }

      return {
        content: dep.filePath,
        metadata: { relationship: dep.relationship, depth: dep.depth },
        score: Math.max(score, 0),
        reason: reasons.join(', '),
      };
    });

    return ranked
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }

  /**
   * Helper: Count occurrences of a pattern in text
   */
  private countMatches(text: string, pattern: string): number {
    const regex = new RegExp(pattern, 'gi');
    return (text.match(regex) || []).length;
  }

  /**
   * Helper: Check if two file paths are related
   */
  private areRelatedPaths(path1: string, path2: string): boolean {
    const parts1 = path1.split('/');
    const parts2 = path2.split('/');

    // Same directory
    if (parts1.slice(0, -1).join('/') === parts2.slice(0, -1).join('/')) {
      return true;
    }

    // Same filename base (e.g., foo.ts and foo.test.ts)
    const base1 = parts1[parts1.length - 1].replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, '');
    const base2 = parts2[parts2.length - 1].replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, '');
    if (base1 === base2) {
      return true;
    }

    return false;
  }
}
