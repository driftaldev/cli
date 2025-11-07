import type { GitDiff, DiffFile } from "../../utils/git.js";

export interface ChangeAnalysis {
  type: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'chore';
  complexity: 'trivial' | 'low' | 'medium' | 'high' | 'critical';
  affectedModules: string[];
  riskScore: number; // 0-100
  testCoverage: boolean;
  breakingChange: boolean;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export class ChangeAnalyzer {
  /**
   * Analyze a git diff to understand the nature and complexity of changes
   */
  async analyze(diff: GitDiff): Promise<ChangeAnalysis> {
    const type = this.identifyChangeType(diff);
    const complexity = this.calculateComplexity(diff);
    const affectedModules = this.identifyAffectedModules(diff);
    const riskScore = this.calculateRiskScore(diff);
    const testCoverage = this.detectTestChanges(diff);
    const breakingChange = this.detectBreakingChanges(diff);

    return {
      type,
      complexity,
      affectedModules,
      riskScore,
      testCoverage,
      breakingChange,
      filesChanged: diff.files.length,
      linesAdded: diff.stats.additions,
      linesRemoved: diff.stats.deletions
    };
  }

  /**
   * Identify the type of change (feature, bugfix, refactor, etc.)
   */
  private identifyChangeType(diff: GitDiff): 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'chore' {
    const files = diff.files;

    // Check if only test files changed
    const onlyTests = files.every(f => this.isTestFile(f.path));
    if (onlyTests) return 'test';

    // Check if only documentation changed
    const onlyDocs = files.every(f => this.isDocFile(f.path));
    if (onlyDocs) return 'docs';

    // Analyze commit patterns
    const hasNewFiles = files.some(f => f.status === 'added');
    const hasDeletedFiles = files.some(f => f.status === 'deleted');
    const hasLargeAdditions = diff.stats.additions > diff.stats.deletions * 2;

    // Feature: many new files or large additions
    if (hasNewFiles && hasLargeAdditions) return 'feature';

    // Refactor: lots of changes but relatively balanced additions/deletions
    const isBalanced = Math.abs(diff.stats.additions - diff.stats.deletions) < 50;
    const hasSignificantChanges = diff.stats.additions + diff.stats.deletions > 100;
    if (isBalanced && hasSignificantChanges) return 'refactor';

    // Bugfix: small targeted changes
    const isSmallChange = diff.stats.additions + diff.stats.deletions < 50;
    if (isSmallChange && !hasNewFiles) return 'bugfix';

    // Config/chore: package files, configs
    const onlyConfigFiles = files.every(f =>
      f.path.includes('package.json') ||
      f.path.includes('tsconfig') ||
      f.path.includes('.yml') ||
      f.path.includes('.yaml') ||
      f.path.includes('config')
    );
    if (onlyConfigFiles) return 'chore';

    // Default to feature
    return 'feature';
  }

  /**
   * Calculate complexity of changes
   */
  calculateComplexity(diff: GitDiff): 'trivial' | 'low' | 'medium' | 'high' | 'critical' {
    let score = 0;

    // Factor 1: Number of files changed
    score += diff.files.length * 5;

    // Factor 2: Total lines changed
    const totalLines = diff.stats.additions + diff.stats.deletions;
    score += Math.min(totalLines / 10, 50);

    // Factor 3: Depth of changes (nested functions, classes)
    for (const file of diff.files) {
      score += this.calculateFileComplexity(file) * 10;
    }

    // Factor 4: Critical files (auth, payment, core business logic)
    const hasCriticalFiles = diff.files.some(f => this.isCriticalFile(f.path));
    if (hasCriticalFiles) score += 30;

    // Factor 5: Breaking changes
    if (this.detectBreakingChanges(diff)) score += 40;

    // Classify based on score
    if (score < 20) return 'trivial';
    if (score < 50) return 'low';
    if (score < 100) return 'medium';
    if (score < 200) return 'high';
    return 'critical';
  }

  /**
   * Calculate complexity for a single file
   */
  private calculateFileComplexity(file: DiffFile): number {
    let complexity = 0;

    for (const chunk of file.chunks) {
      for (const line of chunk.lines) {
        if (line.type === 'added' || line.type === 'removed') {
          // Increased complexity for nested structures
          const indentLevel = line.content.search(/\S/);
          complexity += Math.floor(indentLevel / 2);

          // Keywords that indicate complexity
          const complexKeywords = [
            'async', 'await', 'promise', 'callback',
            'try', 'catch', 'throw',
            'if', 'else', 'switch', 'case',
            'for', 'while', 'do',
            'class', 'interface', 'type',
            'function', 'const', 'let', 'var'
          ];

          const lowerContent = line.content.toLowerCase();
          for (const keyword of complexKeywords) {
            if (lowerContent.includes(keyword)) {
              complexity += 0.5;
            }
          }
        }
      }
    }

    return complexity;
  }

  /**
   * Identify affected modules/areas
   */
  identifyAffectedModules(diff: GitDiff): string[] {
    const modules = new Set<string>();

    for (const file of diff.files) {
      const parts = file.path.split('/');

      // Get top-level directory
      if (parts.length > 1) {
        modules.add(parts[0]);
      }

      // Get module name (e.g., src/core/auth -> auth)
      if (parts.length > 2) {
        modules.add(parts[parts.length - 2]);
      }

      // Identify specific areas
      if (file.path.includes('auth') || file.path.includes('login')) {
        modules.add('authentication');
      }
      if (file.path.includes('payment') || file.path.includes('billing')) {
        modules.add('payments');
      }
      if (file.path.includes('api') || file.path.includes('endpoint')) {
        modules.add('api');
      }
      if (file.path.includes('database') || file.path.includes('db')) {
        modules.add('database');
      }
      if (file.path.includes('ui') || file.path.includes('component')) {
        modules.add('ui');
      }
    }

    return Array.from(modules);
  }

  /**
   * Detect if changes include breaking changes
   */
  detectBreakingChanges(diff: GitDiff): boolean {
    for (const file of diff.files) {
      // Deleted files might break imports
      if (file.status === 'deleted') return true;

      // Check for removed exports or public APIs
      for (const chunk of file.chunks) {
        for (const line of chunk.lines) {
          if (line.type === 'removed') {
            const content = line.content.trim();

            // Removed exports
            if (content.startsWith('export ')) return true;

            // Removed public methods/functions
            if (content.includes('public ')) return true;

            // Changed function signatures
            if (content.includes('function ') || content.includes('=>')) {
              // Check if there's a corresponding addition with different signature
              const addedLine = chunk.lines.find(l =>
                l.type === 'added' && l.content.includes(content.split('(')[0])
              );
              if (addedLine && addedLine.content !== content) {
                return true;
              }
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Calculate risk score (0-100)
   */
  private calculateRiskScore(diff: GitDiff): number {
    let risk = 0;

    // Base risk from complexity
    const complexity = this.calculateComplexity(diff);
    const complexityRisk: Record<string, number> = {
      'trivial': 5,
      'low': 15,
      'medium': 30,
      'high': 50,
      'critical': 70
    };
    risk += complexityRisk[complexity];

    // Critical files increase risk
    const hasCriticalFiles = diff.files.some(f => this.isCriticalFile(f.path));
    if (hasCriticalFiles) risk += 20;

    // Breaking changes increase risk
    if (this.detectBreakingChanges(diff)) risk += 25;

    // Lack of test coverage increases risk
    if (!this.detectTestChanges(diff)) risk += 15;

    // Cap at 100
    return Math.min(risk, 100);
  }

  /**
   * Check if test files were modified
   */
  private detectTestChanges(diff: GitDiff): boolean {
    return diff.files.some(f => this.isTestFile(f.path));
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(path: string): boolean {
    return (
      path.includes('.test.') ||
      path.includes('.spec.') ||
      path.includes('__tests__') ||
      path.includes('/tests/') ||
      path.includes('/test/')
    );
  }

  /**
   * Check if a file is documentation
   */
  private isDocFile(path: string): boolean {
    const docExtensions = ['.md', '.txt', '.rst', '.adoc'];
    return docExtensions.some(ext => path.endsWith(ext)) || path.includes('/docs/');
  }

  /**
   * Check if a file is critical (auth, payment, security)
   */
  private isCriticalFile(path: string): boolean {
    const criticalKeywords = [
      'auth', 'login', 'password', 'token', 'jwt',
      'payment', 'billing', 'charge', 'transaction',
      'security', 'crypto', 'encrypt',
      'admin', 'permission', 'role',
      'database', 'migration', 'schema'
    ];

    const lowerPath = path.toLowerCase();
    return criticalKeywords.some(keyword => lowerPath.includes(keyword));
  }
}
