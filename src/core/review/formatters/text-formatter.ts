import chalk from "chalk";
import Table from "cli-table3";
import type { ReviewResults, ReviewIssue, IssueSeverity, IssueType } from "../issue.js";
import { IssueRanker } from "../issue.js";

export class TextFormatter {
  private ranker: IssueRanker;

  constructor() {
    this.ranker = new IssueRanker();
  }

  /**
   * Format review results as beautiful text output
   */
  format(results: ReviewResults): void {
    // Print header
    this.printHeader(results);

    // Print analysis summary if available
    if (results.analysis) {
      this.printAnalysis(results.analysis);
    }

    // Group by severity and print
    const grouped = this.ranker.groupBySeverity(results.issues);

    for (const [severity, issues] of grouped.entries()) {
      if (issues.length === 0) continue;

      console.log(`\n${this.getSeverityIcon(severity)} ${chalk.bold(severity.toUpperCase())} (${issues.length})\n`);

      for (const issue of issues) {
        this.printIssue(issue);
      }
    }

    // Print footer
    this.printFooter(results);
  }

  /**
   * Print header with summary table
   */
  private printHeader(results: ReviewResults): void {
    const table = new Table({
      head: [
        chalk.cyan('Files'),
        chalk.cyan('Issues'),
        chalk.cyan('Critical'),
        chalk.cyan('High'),
        chalk.cyan('Medium'),
        chalk.cyan('Low')
      ],
      style: {
        head: [],
        border: ['gray']
      }
    });

    const counts = this.countBySeverity(results.issues);

    table.push([
      results.filesReviewed.toString(),
      results.issues.length.toString(),
      this.colorBySeverity('critical', counts.critical.toString()),
      this.colorBySeverity('high', counts.high.toString()),
      this.colorBySeverity('medium', counts.medium.toString()),
      this.colorBySeverity('low', counts.low.toString())
    ]);

    console.log('\n' + table.toString());
  }

  /**
   * Print analysis summary
   */
  private printAnalysis(analysis: { type: string; complexity: string; riskScore: number }): void {
    console.log(`\n${chalk.bold('Change Analysis:')}`);
    console.log(`  Type: ${chalk.cyan(analysis.type)}`);
    console.log(`  Complexity: ${this.colorByComplexity(analysis.complexity)}`);
    console.log(`  Risk Score: ${this.colorByRisk(analysis.riskScore)}/100`);
  }

  /**
   * Print a single issue
   */
  private printIssue(issue: ReviewIssue): void {
    const locationStr = chalk.gray(`${issue.location.file}:${issue.location.line}`);
    const confidenceStr = chalk.gray(`[${(issue.confidence * 100).toFixed(0)}%]`);

    console.log(`  ${this.getTypeIcon(issue.type)} ${chalk.bold(issue.title)} ${confidenceStr}`);
    console.log(`     ${locationStr}`);

    // Print description if available
    if (issue.description && issue.description.trim()) {
      console.log(`     ${issue.description}`);
    }

    // Print rationale if description is empty or as additional context
    if (issue.rationale && issue.rationale.trim()) {
      if (!issue.description || !issue.description.trim()) {
        console.log(`     ${issue.rationale}`);
      }
    }

    if (issue.suggestion) {
      console.log(chalk.green(`     💡 Fix available`));
      // Handle both string suggestions and object suggestions
      const suggestionText = typeof issue.suggestion === 'string'
        ? issue.suggestion
        : issue.suggestion.description;
      if (suggestionText) {
        console.log(chalk.gray(`     ${suggestionText}`));
      }
    }

    if (issue.references && issue.references.length > 0) {
      console.log(chalk.gray(`     📚 ${issue.references[0]}`));
    }

    console.log('');
  }

  /**
   * Print footer with statistics
   */
  private printFooter(results: ReviewResults): void {
    if (results.duration) {
      console.log(chalk.gray(`\nCompleted in ${(results.duration / 1000).toFixed(2)}s`));
    }

    if (results.issues.length === 0) {
      console.log(chalk.green('\n✓ No issues found! Code looks good.\n'));
    } else {
      const criticalAndHigh = results.issues.filter(
        i => i.severity === 'critical' || i.severity === 'high'
      ).length;

      if (criticalAndHigh > 0) {
        console.log(chalk.red(`\n⚠️  ${criticalAndHigh} critical/high severity issue(s) require attention\n`));
      } else {
        console.log(chalk.yellow(`\n⚠️  ${results.issues.length} issue(s) found\n`));
      }
    }
  }

  /**
   * Count issues by severity
   */
  private countBySeverity(issues: ReviewIssue[]): Record<IssueSeverity, number> {
    const counts: Record<IssueSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };

    for (const issue of issues) {
      counts[issue.severity]++;
    }

    return counts;
  }

  /**
   * Get severity icon
   */
  private getSeverityIcon(severity: IssueSeverity): string {
    const icons: Record<IssueSeverity, string> = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🔵',
      info: '⚪'
    };

    return icons[severity] || '•';
  }

  /**
   * Get type icon
   */
  private getTypeIcon(type: IssueType): string {
    const icons: Record<IssueType, string> = {
      bug: '🐛',
      security: '🔒',
      performance: '⚡',
      style: '🎨',
      'best-practice': '✨'
    };

    return icons[type] || '•';
  }

  /**
   * Color text by severity
   */
  private colorBySeverity(severity: IssueSeverity, text: string): string {
    switch (severity) {
      case 'critical':
        return chalk.red.bold(text);
      case 'high':
        return chalk.red(text);
      case 'medium':
        return chalk.yellow(text);
      case 'low':
        return chalk.blue(text);
      case 'info':
        return chalk.gray(text);
      default:
        return text;
    }
  }

  /**
   * Color text by complexity
   */
  private colorByComplexity(complexity: string): string {
    switch (complexity) {
      case 'critical':
        return chalk.red.bold(complexity);
      case 'high':
        return chalk.red(complexity);
      case 'medium':
        return chalk.yellow(complexity);
      case 'low':
        return chalk.green(complexity);
      case 'trivial':
        return chalk.gray(complexity);
      default:
        return complexity;
    }
  }

  /**
   * Color text by risk score
   */
  private colorByRisk(score: number): string {
    const scoreStr = score.toString();

    if (score >= 70) return chalk.red.bold(scoreStr);
    if (score >= 50) return chalk.red(scoreStr);
    if (score >= 30) return chalk.yellow(scoreStr);
    return chalk.green(scoreStr);
  }
}
