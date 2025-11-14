import { logger } from "../../utils/logger.js";

export type IssueType = 'bug' | 'security' | 'performance' | 'style' | 'best-practice';
export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReviewIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  confidence: number; // 0.0-1.0
  title: string;
  description: string;
  location: {
    file: string;
    line: number;
    column?: number;
    endLine?: number;
  };
  suggestion?: {
    description: string;
    diff?: string;
    code?: string;
    originalCode?: string;
    fixedCode?: string;
  };
  rationale: string;
  references?: string[];
  tags: string[];
}

export interface ReviewResults {
  issues: ReviewIssue[];
  filesReviewed: number;
  timestamp: number;
  duration?: number;
  analysis?: {
    type: string;
    complexity: string;
    riskScore: number;
  };
  // Metadata for backend logging
  totalTokens?: number; // Total tokens used across all LLM calls
  linesOfCodeReviewed?: number; // Lines of code reviewed (additions + deletions or file lines)
  model?: string; // Model used for the review
  repositoryName?: string; // Repository name
}

export class IssueRanker {
  /**
   * Rank issues by severity and confidence
   */
  rank(issues: ReviewIssue[]): ReviewIssue[] {
    return issues.sort((a, b) => {
      // 1. Sort by severity first
      const severityScore = this.getSeverityScore(a.severity) - this.getSeverityScore(b.severity);
      if (severityScore !== 0) return severityScore;

      // 2. Then by confidence
      return b.confidence - a.confidence;
    });
  }

  /**
   * Filter issues by minimum severity
   */
  filter(issues: ReviewIssue[], minSeverity: IssueSeverity): ReviewIssue[] {
    const minScore = this.getSeverityScore(minSeverity);
    return issues.filter(issue => this.getSeverityScore(issue.severity) <= minScore);
  }

  /**
   * Filter by minimum confidence
   */
  filterByConfidence(issues: ReviewIssue[], minConfidence: number): ReviewIssue[] {
    return issues.filter(issue => issue.confidence >= minConfidence);
  }

  /**
   * Group issues by file
   */
  groupByFile(issues: ReviewIssue[]): Map<string, ReviewIssue[]> {
    const grouped = new Map<string, ReviewIssue[]>();

    for (const issue of issues) {
      const file = issue.location.file;
      if (!grouped.has(file)) {
        grouped.set(file, []);
      }
      grouped.get(file)!.push(issue);
    }

    return grouped;
  }

  /**
   * Group issues by severity
   */
  groupBySeverity(issues: ReviewIssue[]): Map<IssueSeverity, ReviewIssue[]> {
    const grouped = new Map<IssueSeverity, ReviewIssue[]>();
    const severities: IssueSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

    for (const severity of severities) {
      grouped.set(severity, []);
    }

    for (const issue of issues) {
      grouped.get(issue.severity)!.push(issue);
    }

    return grouped;
  }

  /**
   * Group issues by type
   */
  groupByType(issues: ReviewIssue[]): Map<IssueType, ReviewIssue[]> {
    const grouped = new Map<IssueType, ReviewIssue[]>();
    const types: IssueType[] = ['bug', 'security', 'performance', 'style', 'best-practice'];

    for (const type of types) {
      grouped.set(type, []);
    }

    for (const issue of issues) {
      grouped.get(issue.type)!.push(issue);
    }

    return grouped;
  }

  /**
   * Deduplicate similar issues
   */
  deduplicate(issues: ReviewIssue[]): ReviewIssue[] {
    const seen = new Set<string>();
    const unique: ReviewIssue[] = [];

    for (const issue of issues) {
      const key = `${issue.location.file}:${issue.location.line}:${issue.type}:${issue.title}`;

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(issue);
      }
    }

    return unique;
  }

  /**
   * Get severity score (lower is more severe)
   */
  private getSeverityScore(severity: IssueSeverity): number {
    const scores: Record<IssueSeverity, number> = {
      'critical': 0,
      'high': 1,
      'medium': 2,
      'low': 3,
      'info': 4
    };

    return scores[severity] || 5;
  }
}

/**
 * Generate a unique ID for an issue
 */
export function generateIssueId(): string {
  return `issue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse LLM response into ReviewIssues
 */
export function parseIssuesFromLLM(
  llmResponse: string,
  fileName: string,
  verbose: boolean = false
): ReviewIssue[] {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = llmResponse.match(/```json\n([\s\S]*?)\n```/);
    const jsonString = jsonMatch ? jsonMatch[1] : llmResponse;

    if (verbose) {
      console.log('\n=== LLM Response ===');
      console.log(llmResponse);
      console.log('\n=== Parsed JSON String ===');
      console.log(jsonString);
    }

    const parsed = JSON.parse(jsonString);
    const issuesArray = Array.isArray(parsed) ? parsed : [parsed];

    if (verbose) {
      console.log('\n=== Parsed Issues Array ===');
      console.log(JSON.stringify(issuesArray, null, 2));
    }

    return issuesArray.map((issue: any) => ({
      id: generateIssueId(),
      type: issue.type || 'bug',
      severity: issue.severity || 'medium',
      confidence: issue.confidence || 0.7,
      title: issue.title || 'Untitled Issue',
      description: issue.description || '',
      location: {
        file: fileName,
        line: issue.location?.line || 1,
        column: issue.location?.column,
        endLine: issue.location?.endLine
      },
      suggestion: issue.suggestion,
      rationale: issue.rationale || '',
      references: issue.references || [],
      tags: issue.tags || []
    }));
  } catch (error) {
    logger.error('Failed to parse LLM response as JSON:', error);
    logger.error('Raw LLM response:', llmResponse);
    return [];
  }
}
