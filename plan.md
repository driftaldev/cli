# Code Review Bot Pivot - Complete Implementation Plan

## Executive Summary

Transform Scout Code CLI from a search/index tool into an **interactive CLI-based code review bot** that catches bugs with impressive skill, runs locally-first, and learns repo-specific patterns.

### Key Technologies
- **Mastra**: AI agent orchestration and workflow management
- **Morph**: LLM-powered code diff application
- **Moss**: Semantic code search (existing)
- **Hyperspell**: Repo-specific memory and learning
- **Multi-LLM Support**: Claude, GPT-4, Ollama (local)

### Target Use Case
Interactive CLI code review with developer-initiated analysis, focusing on:
- Logic bugs & edge cases
- Security vulnerabilities
- Performance issues
- Best practices & patterns

---

## Current Architecture Analysis

### Existing Infrastructure (Highly Reusable)

**Strengths:**
- ✅ **Moss Semantic Search**: Local-first code understanding with MiniLM embeddings
- ✅ **Incremental Indexing**: Efficient change detection with file hash tracking
- ✅ **Redis Caching**: 24hr TTL, metrics tracking, performance optimization
- ✅ **MCP Server**: HTTP transport ready for VS Code integration
- ✅ **File Watcher**: Real-time change detection with chokidar
- ✅ **Multi-repo Support**: Index and search across multiple codebases
- ✅ **Git Integration**: Branch detection, changed files utilities

**Gaps to Fill:**
- ❌ No LLM integrations (yet)
- ❌ No code review logic
- ❌ No diff parsing/analysis
- ❌ No memory/learning system
- ❌ No code modification capabilities

### File Structure (Current)
```
src/
├── cli/              # Command implementations
│   ├── index.ts      # Main entry (Commander.js)
│   ├── init.ts       # Setup/configuration
│   ├── index-cmd.ts  # Indexing operations
│   ├── chat-cmd.ts   # Interactive search
│   ├── serve.ts      # MCP server
│   └── stats.ts      # Cache metrics
├── core/
│   ├── indexer/      # Moss client, file scanner
│   ├── mcp/          # Model Context Protocol server
│   ├── query/        # Search routing, context building
│   └── cache/        # Redis caching layer
├── config/           # Configuration schema & defaults
└── utils/            # Git, files, logging utilities
```

---

## Phase 1: LLM Provider Abstraction Layer

**Goal:** Multi-provider support with Mastra orchestration

### 1.1 Mastra Integration Foundation

**New Files:**
```typescript
// src/core/agents/mastra-setup.ts
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';

export function initializeMastra(): Mastra {
  return new Mastra({
    agents: {
      codeReviewer: createReviewAgent(),
      securityAnalyzer: createSecurityAgent(),
      performanceAnalyzer: createPerformanceAgent(),
      patternAnalyzer: createPatternAgent(),
    },
    workflows: {
      fullReview: createFullReviewWorkflow(),
      quickReview: createQuickReviewWorkflow(),
      securityScan: createSecurityScanWorkflow(),
    },
  });
}

// src/core/agents/review-agent.ts
export function createReviewAgent(): Agent {
  return new Agent({
    name: 'code-reviewer',
    instructions: `You are an expert code reviewer...`,
    model: {
      provider: 'anthropic', // or openai, ollama
      name: 'claude-3-5-sonnet',
      toolChoice: 'auto',
    },
    tools: {
      searchSimilarCode: createMossSearchTool(),
      getRepoContext: createContextTool(),
      checkHistory: createMemoryTool(),
    },
  });
}
```

### 1.2 Provider Abstraction

**New Files:**
```
src/core/llm/
├── provider.ts              # Abstract provider interface
├── providers/
│   ├── anthropic.ts         # Claude implementation
│   ├── openai.ts            # GPT-4 implementation
│   └── ollama.ts            # Local models (CodeLlama, DeepSeek)
├── provider-factory.ts      # Factory with config-based instantiation
└── config.ts                # Provider configuration types
```

**Key Features:**
- Unified interface for all providers
- Automatic retries with exponential backoff
- Rate limiting per provider
- Token counting and budget management
- Streaming response support
- Fallback chains (primary → secondary → local)

### 1.3 Configuration Schema Extension

```typescript
// src/config/schema.ts additions
interface LLMConfig {
  providers: {
    primary: 'anthropic' | 'openai' | 'ollama';
    fallback?: 'anthropic' | 'openai' | 'ollama';
    anthropic?: {
      apiKey: string;
      model: string; // claude-3-5-sonnet, etc.
      maxTokens: number;
    };
    openai?: {
      apiKey: string;
      model: string; // gpt-4-turbo, etc.
      maxTokens: number;
    };
    ollama?: {
      baseUrl: string; // http://localhost:11434
      model: string; // codellama, deepseek-coder
    };
  };
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}

interface ReviewConfig {
  severity: 'relaxed' | 'balanced' | 'strict';
  analyzers: ('logic' | 'security' | 'performance' | 'patterns')[];
  autoFix: boolean;
  confidence: number; // 0.0-1.0, minimum confidence to show issues
}
```

### 1.4 Prompt Templates

```
src/core/llm/prompts/
├── system-prompts.ts        # Base system prompts
├── review-templates.ts      # Bug detection, security, performance
├── explanation-templates.ts # Code explanation prompts
└── fix-templates.ts         # Fix suggestion generation
```

**Template System:**
- Context injection from Moss search
- Repo-specific conventions from Hyperspell
- Diff-aware prompting
- Chain-of-thought for complex analysis

---

## Phase 2: Enhanced Git & Diff Analysis

**Goal:** Deep understanding of code changes for targeted reviews

### 2.1 Advanced Git Utilities

```typescript
// src/utils/git.ts extensions
export interface GitDiff {
  files: DiffFile[];
  stats: { additions: number; deletions: number; };
  base: string;
  head: string;
}

export interface DiffFile {
  path: string;
  oldPath?: string; // for renames
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  chunks: DiffChunk[];
  language: string;
}

export interface DiffChunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  context: string; // function/class context
}

export async function getDiff(base: string, head: string): Promise<GitDiff>;
export async function getUnstagedChanges(): Promise<GitDiff>;
export async function getStagedChanges(): Promise<GitDiff>;
export async function getCommitDiff(sha: string): Promise<GitDiff>;
export async function getFileHistory(path: string, limit?: number): Promise<Commit[]>;
```

### 2.2 Diff Parser

```typescript
// src/core/review/diff-parser.ts
import { parseDiff } from 'diff-parse';

export class DiffParser {
  parse(diffString: string): GitDiff;
  extractAddedLines(file: DiffFile): DiffLine[];
  extractModifiedLines(file: DiffFile): DiffLine[];
  getContextLines(chunk: DiffChunk, lineNumber: number, context: number): string;
  mapToOriginalLine(file: DiffFile, newLineNumber: number): number | null;
}
```

### 2.3 Change Analyzer

```typescript
// src/core/review/change-analyzer.ts
export interface ChangeAnalysis {
  type: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'chore';
  complexity: 'trivial' | 'low' | 'medium' | 'high' | 'critical';
  affectedModules: string[];
  riskScore: number; // 0-100
  testCoverage: boolean;
  breakingChange: boolean;
}

export class ChangeAnalyzer {
  async analyze(diff: GitDiff): Promise<ChangeAnalysis>;
  calculateComplexity(diff: GitDiff): number;
  identifyAffectedModules(diff: GitDiff): string[];
  detectBreakingChanges(diff: GitDiff): boolean;
}
```

---

## Phase 3: Mastra-Powered Review Engine

**Goal:** Orchestrated, intelligent code review using AI agents

### 3.1 Review Workflows with Mastra

```typescript
// src/core/agents/workflows/full-review.ts
import { Workflow } from '@mastra/core';

export function createFullReviewWorkflow(): Workflow {
  return new Workflow({
    name: 'full-review',
    triggerSchema: z.object({
      files: z.array(z.string()),
      diff: z.object({ /* GitDiff schema */ }),
      context: z.object({ /* repo context */ }),
    }),
  })
  .step('analyze-changes', async ({ context }) => {
    // Use ChangeAnalyzer to understand scope
    const analysis = await changeAnalyzer.analyze(context.trigger.diff);
    return { analysis };
  })
  .step('gather-context', async ({ context }) => {
    // Use Moss to find similar patterns
    const similar = await mossClient.search({
      query: context.trigger.diff.summary,
      topK: 5,
    });
    return { similar };
  })
  .step('parallel-analysis', async ({ context }) => {
    // Run all analyzers in parallel via Mastra agents
    return await Promise.all([
      agents.securityAnalyzer.generate(context),
      agents.performanceAnalyzer.generate(context),
      agents.patternAnalyzer.generate(context),
    ]);
  })
  .step('synthesize-results', async ({ context }) => {
    // Aggregate and rank issues
    const issues = synthesizeIssues(context.steps['parallel-analysis']);
    return { issues };
  })
  .step('check-memory', async ({ context }) => {
    // Query Hyperspell for similar past reviews
    const history = await hyperspell.query(context.trigger.diff);
    return { history };
  })
  .step('generate-recommendations', async ({ context }) => {
    // Final agent pass to create actionable recommendations
    return await agents.codeReviewer.generate({
      issues: context.steps['synthesize-results'].issues,
      history: context.steps['check-memory'].history,
    });
  });
}
```

### 3.2 Specialized Agents

```typescript
// src/core/agents/specialized/
├── security-agent.ts        # OWASP, secret detection, auth flows
├── performance-agent.ts     # Complexity, memory, bottlenecks
├── logic-agent.ts           # Edge cases, race conditions, bugs
└── pattern-agent.ts         # Best practices, design patterns
```

**Agent Configuration:**
```typescript
export function createSecurityAgent(): Agent {
  return new Agent({
    name: 'security-analyzer',
    instructions: `You are a security expert specializing in:
    - OWASP Top 10 vulnerabilities
    - Secret and credential detection
    - Authentication and authorization flaws
    - Input validation and sanitization
    - Cryptographic issues

    Analyze code changes for security vulnerabilities.
    Provide severity (critical/high/medium/low) and remediation steps.`,
    model: {
      provider: config.llm.providers.primary,
      name: config.llm.providers[config.llm.providers.primary].model,
      toolChoice: 'auto',
    },
    tools: {
      searchVulnerablePatterns: createVulnerabilitySearchTool(),
      checkSecrets: createSecretDetectionTool(),
      analyzeAuthFlow: createAuthFlowTool(),
    },
  });
}
```

### 3.3 Context Builder with Moss Integration

```typescript
// src/core/review/context-builder.ts
export class ContextBuilder {
  constructor(
    private mossClient: MossClient,
    private hyperspell: HyperspellClient
  ) {}

  async buildContext(diff: GitDiff): Promise<ReviewContext> {
    // 1. Extract changed code sections
    const changedSections = this.extractChangedSections(diff);

    // 2. Find similar patterns via Moss
    const similarPatterns = await Promise.all(
      changedSections.map(section =>
        this.mossClient.search({
          query: section.code,
          topK: 3,
          filters: { fileType: section.language }
        })
      )
    );

    // 3. Get test files for changed code
    const testFiles = await this.findRelatedTests(diff.files);

    // 4. Retrieve repo conventions from Hyperspell
    const conventions = await this.hyperspell.getConventions(
      this.getCurrentRepo()
    );

    // 5. Get historical issues from similar changes
    const history = await this.hyperspell.querySimilarReviews(
      changedSections
    );

    return {
      changes: changedSections,
      similar: similarPatterns,
      tests: testFiles,
      conventions,
      history,
    };
  }
}
```

### 3.4 Issue Classification & Ranking

```typescript
// src/core/review/issue.ts
export interface ReviewIssue {
  id: string;
  type: 'bug' | 'security' | 'performance' | 'style' | 'best-practice';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
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
    diff: string; // Morph-compatible diff
    code?: string; // Full replacement code
  };
  rationale: string; // Why this is an issue
  references?: string[]; // Docs, similar code, past reviews
  tags: string[];
}

export class IssueRanker {
  rank(issues: ReviewIssue[]): ReviewIssue[] {
    return issues
      .sort((a, b) => {
        // 1. Severity first
        const severityScore = this.getSeverityScore(a.severity) - this.getSeverityScore(b.severity);
        if (severityScore !== 0) return severityScore;

        // 2. Then confidence
        return b.confidence - a.confidence;
      });
  }

  private getSeverityScore(severity: string): number {
    const scores = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return scores[severity] || 5;
  }
}
```

---

## Phase 4: Morph Integration for Code Fixes

**Goal:** LLM-powered code diff application with user approval

### 4.1 Morph Client Setup

```typescript
// src/core/morph/morph-client.ts
import { Morph } from '@morph-labs/morph';

export class MorphClient {
  private morph: Morph;

  constructor(llmProvider: LLMProvider) {
    this.morph = new Morph({
      model: llmProvider.getModelName(),
      apiKey: llmProvider.getApiKey(),
    });
  }

  async applyFix(
    filePath: string,
    instruction: string,
    diff?: string
  ): Promise<MorphResult> {
    const fileContent = await fs.readFile(filePath, 'utf-8');

    return await this.morph.apply({
      file: fileContent,
      instruction: instruction,
      diff: diff, // Optional: provide specific diff to apply
      language: this.detectLanguage(filePath),
    });
  }

  async generateDiff(
    originalCode: string,
    instruction: string
  ): Promise<string> {
    const result = await this.morph.apply({
      file: originalCode,
      instruction,
      dryRun: true, // Don't apply, just generate diff
    });

    return result.diff;
  }
}

export interface MorphResult {
  success: boolean;
  originalCode: string;
  modifiedCode: string;
  diff: string;
  explanation: string;
}
```

### 4.2 Interactive Fix Application

```typescript
// src/core/review/fix-applier.ts
import inquirer from 'inquirer';
import chalk from 'chalk';
import { diffLines } from 'diff';

export class FixApplier {
  constructor(
    private morphClient: MorphClient,
    private gitUtils: GitUtils
  ) {}

  async applyRecommendation(issue: ReviewIssue): Promise<boolean> {
    if (!issue.suggestion) {
      console.log(chalk.yellow('No fix suggestion available for this issue'));
      return false;
    }

    // 1. Show the issue details
    this.displayIssue(issue);

    // 2. Generate or retrieve the fix
    let morphResult: MorphResult;

    if (issue.suggestion.diff) {
      // Use provided diff
      morphResult = await this.morphClient.applyFix(
        issue.location.file,
        issue.suggestion.description,
        issue.suggestion.diff
      );
    } else {
      // Let Morph generate the fix
      morphResult = await this.morphClient.applyFix(
        issue.location.file,
        issue.suggestion.description
      );
    }

    // 3. Show the diff
    this.displayDiff(morphResult);

    // 4. Ask for confirmation
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Apply fix', value: 'apply' },
          { name: 'Edit fix before applying', value: 'edit' },
          { name: 'Skip', value: 'skip' },
          { name: 'Never show this type of issue again', value: 'suppress' },
        ],
      },
    ]);

    // 5. Execute action
    switch (action) {
      case 'apply':
        await this.writeFix(issue.location.file, morphResult.modifiedCode);
        await this.recordFeedback(issue, 'accepted');
        console.log(chalk.green('✓ Fix applied'));
        return true;

      case 'edit':
        const edited = await this.openEditor(morphResult.modifiedCode);
        await this.writeFix(issue.location.file, edited);
        await this.recordFeedback(issue, 'modified');
        console.log(chalk.green('✓ Edited fix applied'));
        return true;

      case 'skip':
        await this.recordFeedback(issue, 'skipped');
        return false;

      case 'suppress':
        await this.suppressIssueType(issue);
        await this.recordFeedback(issue, 'suppressed');
        console.log(chalk.yellow('✓ Issue type suppressed'));
        return false;
    }
  }

  private displayDiff(result: MorphResult) {
    const diff = diffLines(result.originalCode, result.modifiedCode);

    console.log(chalk.bold('\n📝 Proposed Changes:\n'));

    diff.forEach(part => {
      const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
      const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
      const lines = part.value.split('\n').filter(line => line);
      lines.forEach(line => console.log(color(prefix + line)));
    });

    if (result.explanation) {
      console.log(chalk.cyan('\n💡 Explanation: ') + result.explanation);
    }
  }

  async batchApplyFixes(issues: ReviewIssue[]): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];

    for (const issue of issues) {
      if (!issue.suggestion) continue;

      const applied = await this.applyRecommendation(issue);
      results.push({ issue, applied });

      // Don't overwhelm the user - ask if they want to continue
      if (results.length % 5 === 0) {
        const { shouldContinue } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldContinue',
            message: 'Continue applying fixes?',
            default: true,
          },
        ]);

        if (!shouldContinue) break;
      }
    }

    return results;
  }

  private async recordFeedback(
    issue: ReviewIssue,
    action: 'accepted' | 'modified' | 'skipped' | 'suppressed'
  ) {
    // Store in Hyperspell for learning
    await hyperspell.recordFeedback({
      issueType: issue.type,
      severity: issue.severity,
      action,
      timestamp: Date.now(),
      repo: this.gitUtils.getCurrentRepo(),
    });
  }
}
```

### 4.3 Diff Preview & Staging

```typescript
// src/core/review/diff-preview.ts
export class DiffPreview {
  async showInteractiveDiff(
    original: string,
    modified: string,
    file: string
  ): Promise<void> {
    // Split-pane view in terminal
    const width = process.stdout.columns;
    const halfWidth = Math.floor(width / 2);

    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    console.log(chalk.bold('┌' + '─'.repeat(halfWidth - 2) + '┬' + '─'.repeat(halfWidth - 2) + '┐'));
    console.log(chalk.bold('│ ' + chalk.red('BEFORE').padEnd(halfWidth - 2) + '│ ' + chalk.green('AFTER').padEnd(halfWidth - 2) + '│'));
    console.log(chalk.bold('├' + '─'.repeat(halfWidth - 2) + '┼' + '─'.repeat(halfWidth - 2) + '┤'));

    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLines; i++) {
      const left = originalLines[i] || '';
      const right = modifiedLines[i] || '';

      const leftDisplay = left.substring(0, halfWidth - 4).padEnd(halfWidth - 4);
      const rightDisplay = right.substring(0, halfWidth - 4).padEnd(halfWidth - 4);

      console.log(`│ ${chalk.red(leftDisplay)} │ ${chalk.green(rightDisplay)} │`);
    }

    console.log(chalk.bold('└' + '─'.repeat(halfWidth - 2) + '┴' + '─'.repeat(halfWidth - 2) + '┘'));
  }

  async createGitPatch(fixes: AppliedFix[]): Promise<string> {
    // Generate a .patch file for all applied fixes
    const patches = fixes.map(fix => {
      return `diff --git a/${fix.file} b/${fix.file}
--- a/${fix.file}
+++ b/${fix.file}
${fix.diff}`;
    });

    return patches.join('\n\n');
  }
}
```

---

## Phase 5: Hyperspell Memory System

**Goal:** Repo-specific learning and pattern recognition

### 5.1 Hyperspell Client Setup

```typescript
// src/core/memory/hyperspell-client.ts
import { Hyperspell } from 'hyperspell';

export class HyperspellClient {
  private client: Hyperspell;
  private namespace: string;

  constructor(repoPath: string) {
    this.namespace = this.generateNamespace(repoPath);
    this.client = new Hyperspell({
      namespace: this.namespace,
      apiKey: config.hyperspell.apiKey,
      localMode: config.hyperspell.localMode, // For fully local operation
    });
  }

  async initialize(): Promise<void> {
    await this.client.connect();
    await this.setupSchema();
  }

  private async setupSchema(): Promise<void> {
    await this.client.defineCollection('reviews', {
      fields: {
        issueType: 'string',
        severity: 'string',
        description: 'text',
        code: 'text',
        embedding: 'vector',
        feedback: 'string',
        timestamp: 'number',
        file: 'string',
        language: 'string',
      },
      indexes: ['issueType', 'severity', 'language'],
    });

    await this.client.defineCollection('conventions', {
      fields: {
        category: 'string',
        pattern: 'text',
        description: 'text',
        examples: 'json',
        confidence: 'number',
      },
    });

    await this.client.defineCollection('feedback', {
      fields: {
        issueId: 'string',
        action: 'string',
        timestamp: 'number',
      },
    });
  }
}
```

### 5.2 Memory Operations

```typescript
// src/core/memory/operations.ts
export class MemoryOperations {
  constructor(private hyperspell: HyperspellClient) {}

  async storeReview(review: ReviewIssue, feedback?: string): Promise<void> {
    await this.hyperspell.insert('reviews', {
      issueType: review.type,
      severity: review.severity,
      description: review.description,
      code: this.extractCodeContext(review),
      feedback: feedback || 'pending',
      timestamp: Date.now(),
      file: review.location.file,
      language: this.detectLanguage(review.location.file),
    });
  }

  async querySimilarReviews(
    code: string,
    limit: number = 5
  ): Promise<StoredReview[]> {
    return await this.hyperspell.search('reviews', {
      query: code,
      limit,
      filters: {
        feedback: ['accepted', 'modified'], // Only helpful reviews
      },
    });
  }

  async learnConvention(pattern: CodePattern): Promise<void> {
    // Check if similar convention exists
    const existing = await this.hyperspell.search('conventions', {
      query: pattern.description,
      limit: 1,
    });

    if (existing.length > 0 && existing[0].similarity > 0.9) {
      // Update confidence
      await this.hyperspell.update('conventions', existing[0].id, {
        confidence: existing[0].confidence + 0.1,
      });
    } else {
      // Create new convention
      await this.hyperspell.insert('conventions', {
        category: pattern.category,
        pattern: pattern.code,
        description: pattern.description,
        examples: pattern.examples,
        confidence: 0.5,
      });
    }
  }

  async getRepoConventions(): Promise<CodeConvention[]> {
    return await this.hyperspell.query('conventions', {
      filters: {
        confidence: { $gte: 0.7 }, // Only high-confidence conventions
      },
      orderBy: 'confidence',
      order: 'desc',
    });
  }

  async recordFeedback(
    issueId: string,
    action: 'accepted' | 'modified' | 'skipped' | 'suppressed'
  ): Promise<void> {
    await this.hyperspell.insert('feedback', {
      issueId,
      action,
      timestamp: Date.now(),
    });

    // Update review record
    await this.hyperspell.update('reviews', issueId, {
      feedback: action,
    });

    // Adjust confidence for similar future reviews
    if (action === 'suppressed' || action === 'skipped') {
      await this.adjustSimilarReviewsConfidence(issueId, -0.1);
    } else {
      await this.adjustSimilarReviewsConfidence(issueId, +0.1);
    }
  }
}
```

### 5.3 Learning System

```typescript
// src/core/memory/learning.ts
export class LearningSystem {
  constructor(
    private hyperspell: HyperspellClient,
    private mossClient: MossClient
  ) {}

  async analyzeAcceptedPRs(limit: number = 10): Promise<void> {
    // Scan git history for merged PRs
    const mergedPRs = await this.gitUtils.getMergedPRs(limit);

    for (const pr of mergedPRs) {
      // Extract patterns from accepted code
      const patterns = await this.extractPatterns(pr.diff);

      // Store as conventions
      for (const pattern of patterns) {
        await this.memoryOps.learnConvention(pattern);
      }
    }

    console.log(chalk.green(`✓ Learned from ${mergedPRs.length} merged PRs`));
  }

  async extractPatterns(diff: GitDiff): Promise<CodePattern[]> {
    const patterns: CodePattern[] = [];

    for (const file of diff.files) {
      if (file.status !== 'added' && file.status !== 'modified') continue;

      // Use Moss to find similar code
      const similar = await this.mossClient.search({
        query: this.getAddedCode(file),
        topK: 5,
      });

      // If this pattern appears frequently, it's a convention
      if (similar.length >= 3) {
        patterns.push({
          category: this.categorizePattern(file),
          code: this.getAddedCode(file),
          description: await this.describePattern(file),
          examples: similar.map(s => s.content),
        });
      }
    }

    return patterns;
  }

  async generateRepoProfile(): Promise<RepoProfile> {
    const conventions = await this.memoryOps.getRepoConventions();
    const reviewHistory = await this.getReviewStats();

    return {
      conventions: conventions.map(c => ({
        category: c.category,
        description: c.description,
        confidence: c.confidence,
      })),
      commonIssues: reviewHistory.topIssues,
      codeStyle: await this.inferCodeStyle(),
      testingPatterns: await this.inferTestingPatterns(),
    };
  }
}
```

---

## Phase 6: CLI Commands & Interactive Experience

**Goal:** Developer-friendly interface for code reviews

### 6.1 Main Review Command

```typescript
// src/cli/review-cmd.ts
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import Table from 'cli-table3';

export function createReviewCommand(): Command {
  return new Command('review')
    .description('Review code changes for bugs, security issues, and best practices')
    .argument('[files...]', 'Specific files to review (default: all changes)')
    .option('--staged', 'Review only staged changes')
    .option('--commit <sha>', 'Review a specific commit')
    .option('--branch <name>', 'Review changes in a branch')
    .option('--severity <level>', 'Minimum severity to show (critical|high|medium|low|info)', 'low')
    .option('--type <types...>', 'Issue types to check (bug|security|performance|style)', ['bug', 'security', 'performance'])
    .option('--fix', 'Interactively apply suggested fixes')
    .option('--auto-fix', 'Automatically apply safe fixes without prompting')
    .option('--format <format>', 'Output format (text|json|markdown)', 'text')
    .option('--watch', 'Watch mode - review on file changes')
    .option('--no-cache', 'Skip cache, force fresh analysis')
    .option('--quick', 'Quick mode - faster but less thorough')
    .action(async (files, options) => {
      const spinner = ora('Initializing review...').start();

      try {
        // 1. Initialize services
        const mastra = initializeMastra();
        const reviewer = new CodeReviewer(mastra);

        // 2. Get changes to review
        spinner.text = 'Analyzing changes...';
        const diff = await this.getChanges(files, options);

        if (!diff || diff.files.length === 0) {
          spinner.succeed('No changes to review');
          return;
        }

        // 3. Build context
        spinner.text = 'Gathering context...';
        const context = await contextBuilder.buildContext(diff);

        // 4. Run review
        spinner.text = 'Running analysis...';
        const results = await reviewer.review(diff, context, options);

        spinner.succeed(`Review complete - found ${results.issues.length} issues`);

        // 5. Display results
        this.displayResults(results, options.format);

        // 6. Offer fixes
        if (options.fix && results.issues.some(i => i.suggestion)) {
          await this.applyFixes(results.issues, options.autoFix);
        }

        // 7. Watch mode
        if (options.watch) {
          this.startWatchMode(files, options);
        }

      } catch (error) {
        spinner.fail('Review failed');
        console.error(chalk.red(error.message));
      }
    });
}
```

### 6.2 Additional Commands

```typescript
// src/cli/explain-cmd.ts
export function createExplainCommand(): Command {
  return new Command('explain')
    .description('Explain code at a specific location')
    .argument('<file:line>', 'File and line number (e.g., src/index.ts:42)')
    .option('--context <lines>', 'Number of context lines', '10')
    .action(async (location, options) => {
      const [file, line] = location.split(':');
      const code = await this.getCodeContext(file, parseInt(line), options.context);

      const explanation = await agents.codeReviewer.generate({
        prompt: `Explain this code:\n\n${code}`,
        context: await contextBuilder.buildContext({ files: [file] }),
      });

      console.log(chalk.cyan('\n📖 Explanation:\n'));
      console.log(explanation);
    });
}

// src/cli/suggest-cmd.ts
export function createSuggestCommand(): Command {
  return new Command('suggest')
    .description('Get implementation suggestions')
    .argument('<description>', 'What you want to implement')
    .option('--file <path>', 'Target file for the implementation')
    .option('--apply', 'Apply the suggestion with Morph')
    .action(async (description, options) => {
      const spinner = ora('Generating suggestions...').start();

      const context = options.file
        ? await contextBuilder.buildContext({ files: [options.file] })
        : await contextBuilder.buildContext({ repo: true });

      const suggestion = await agents.codeReviewer.generate({
        prompt: `Suggest an implementation for: ${description}`,
        context,
      });

      spinner.succeed('Suggestion ready');
      console.log(chalk.cyan('\n💡 Suggestion:\n'));
      console.log(suggestion.description);
      console.log(chalk.gray('\n--- Code ---\n'));
      console.log(suggestion.code);

      if (options.apply && options.file) {
        const morphResult = await morphClient.applyFix(
          options.file,
          description,
          suggestion.diff
        );

        await fixApplier.applyRecommendation({
          suggestion: {
            description: suggestion.description,
            diff: morphResult.diff,
          },
          location: { file: options.file, line: 1 },
        });
      }
    });
}

// src/cli/learn-cmd.ts
export function createLearnCommand(): Command {
  return new Command('learn')
    .description('Learn patterns from merged PRs and accepted reviews')
    .option('--prs <count>', 'Number of PRs to analyze', '10')
    .option('--profile', 'Generate and display repo profile')
    .action(async (options) => {
      const spinner = ora('Analyzing repository...').start();

      const learner = new LearningSystem(hyperspell, mossClient);

      spinner.text = 'Learning from merged PRs...';
      await learner.analyzeAcceptedPRs(parseInt(options.prs));

      if (options.profile) {
        spinner.text = 'Generating repo profile...';
        const profile = await learner.generateRepoProfile();
        spinner.succeed('Profile ready');

        console.log(chalk.bold('\n📊 Repository Profile\n'));
        console.log(chalk.cyan('Conventions:'));
        profile.conventions.forEach(c => {
          console.log(`  • ${c.description} (confidence: ${(c.confidence * 100).toFixed(0)}%)`);
        });
      } else {
        spinner.succeed('Learning complete');
      }
    });
}
```

### 6.3 Beautiful Terminal Output

```typescript
// src/core/review/formatters/text-formatter.ts
export class TextFormatter {
  format(results: ReviewResults): void {
    // Summary header
    this.printHeader(results);

    // Group by severity
    const grouped = this.groupBySeverity(results.issues);

    for (const [severity, issues] of Object.entries(grouped)) {
      if (issues.length === 0) continue;

      console.log(chalk.bold(`\n${this.getSeverityIcon(severity)} ${severity.toUpperCase()} (${issues.length})\n`));

      for (const issue of issues) {
        this.printIssue(issue);
      }
    }

    // Statistics footer
    this.printFooter(results);
  }

  private printIssue(issue: ReviewIssue): void {
    const locationStr = chalk.gray(`${issue.location.file}:${issue.location.line}`);
    const confidenceStr = chalk.gray(`[${(issue.confidence * 100).toFixed(0)}%]`);

    console.log(`  ${this.getTypeIcon(issue.type)} ${chalk.bold(issue.title)} ${confidenceStr}`);
    console.log(`     ${locationStr}`);
    console.log(`     ${issue.description}`);

    if (issue.suggestion) {
      console.log(chalk.green(`     💡 Fix available - run with --fix to apply`));
    }

    if (issue.references && issue.references.length > 0) {
      console.log(chalk.gray(`     📚 ${issue.references[0]}`));
    }

    console.log('');
  }

  private printHeader(results: ReviewResults): void {
    const table = new Table({
      head: ['Files', 'Issues', 'Critical', 'High', 'Medium', 'Low'],
      style: { head: ['cyan'] },
    });

    const counts = this.countBySeverity(results.issues);
    table.push([
      results.filesReviewed,
      results.issues.length,
      counts.critical || 0,
      counts.high || 0,
      counts.medium || 0,
      counts.low || 0,
    ]);

    console.log('\n' + table.toString());
  }

  private getSeverityIcon(severity: string): string {
    const icons = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🔵',
      info: '⚪',
    };
    return icons[severity] || '•';
  }

  private getTypeIcon(type: string): string {
    const icons = {
      bug: '🐛',
      security: '🔒',
      performance: '⚡',
      style: '🎨',
      'best-practice': '✨',
    };
    return icons[type] || '•';
  }
}
```

### 6.4 Watch Mode

```typescript
// src/core/review/watcher.ts
import chokidar from 'chokidar';

export class ReviewWatcher {
  private watcher: chokidar.FSWatcher;
  private debounceTimer: NodeJS.Timeout;

  async start(paths: string[], options: ReviewOptions): Promise<void> {
    console.log(chalk.cyan('👀 Watching for changes...\n'));

    this.watcher = chokidar.watch(paths, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('change', (path) => this.handleChange(path, options))
      .on('add', (path) => this.handleChange(path, options));
  }

  private async handleChange(path: string, options: ReviewOptions): Promise<void> {
    // Debounce rapid changes
    clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(async () => {
      console.log(chalk.gray(`\n📝 File changed: ${path}\n`));

      const spinner = ora('Reviewing changes...').start();

      try {
        const diff = await gitUtils.getUnstagedChanges();
        const filteredDiff = this.filterDiffByPath(diff, path);

        const results = await reviewer.review(filteredDiff, null, {
          ...options,
          quick: true, // Faster for watch mode
        });

        spinner.stop();

        if (results.issues.length > 0) {
          // Only show critical and high severity in watch mode
          const important = results.issues.filter(
            i => i.severity === 'critical' || i.severity === 'high'
          );

          if (important.length > 0) {
            console.log(chalk.red(`⚠️  Found ${important.length} important issue(s)`));
            textFormatter.format({ ...results, issues: important });

            // Optional: Desktop notification
            notifier.notify({
              title: 'Scout Code Review',
              message: `Found ${important.length} important issue(s) in ${path}`,
            });
          }
        } else {
          console.log(chalk.green('✓ No issues found'));
        }

        console.log(chalk.cyan('\n👀 Watching for changes...\n'));

      } catch (error) {
        spinner.fail('Review failed');
        console.error(chalk.red(error.message));
      }
    }, 500);
  }

  stop(): void {
    this.watcher.close();
  }
}
```

---

## Phase 7: Caching & Performance Optimization

**Goal:** Blazingly fast reviews leveraging existing infrastructure

### 7.1 Multi-Layer Caching

```typescript
// src/core/review/cache-strategy.ts
export class ReviewCacheStrategy {
  constructor(
    private redis: RedisCache,
    private mossClient: MossClient
  ) {}

  async getCachedReview(
    fileHash: string,
    changeHash: string,
    modelVersion: string
  ): Promise<ReviewResults | null> {
    const cacheKey = `review:${fileHash}:${changeHash}:${modelVersion}`;
    return await this.redis.get(cacheKey);
  }

  async cacheReview(
    fileHash: string,
    changeHash: string,
    modelVersion: string,
    results: ReviewResults
  ): Promise<void> {
    const cacheKey = `review:${fileHash}:${changeHash}:${modelVersion}`;
    await this.redis.set(cacheKey, results, 86400); // 24h TTL
  }

  async getCachedAnalyzerResult(
    analyzerName: string,
    codeHash: string
  ): Promise<ReviewIssue[] | null> {
    // Per-analyzer caching for partial results
    const cacheKey = `analyzer:${analyzerName}:${codeHash}`;
    return await this.redis.get(cacheKey);
  }

  async invalidateFileCache(filePath: string): Promise<void> {
    // Invalidate all reviews involving this file
    const pattern = `review:*:${filePath}:*`;
    await this.redis.deletePattern(pattern);
  }
}
```

### 7.2 Smart Review Scope

```typescript
// src/core/review/scope-optimizer.ts
export class ScopeOptimizer {
  async optimizeReviewScope(diff: GitDiff): Promise<OptimizedScope> {
    const scope: OptimizedScope = {
      fullReview: [],
      quickReview: [],
      skip: [],
    };

    for (const file of diff.files) {
      // 1. Check if file type needs review
      if (!this.isReviewableFileType(file.path)) {
        scope.skip.push(file);
        continue;
      }

      // 2. Calculate change complexity
      const complexity = this.calculateComplexity(file);

      // 3. Check cache
      const cached = await this.getCachedReview(file);
      if (cached && complexity < 10) {
        scope.skip.push(file);
        continue;
      }

      // 4. Determine review depth
      if (complexity > 50 || this.isSecuritySensitive(file)) {
        scope.fullReview.push(file);
      } else {
        scope.quickReview.push(file);
      }
    }

    return scope;
  }

  private calculateComplexity(file: DiffFile): number {
    let complexity = 0;

    // Lines changed
    const linesChanged = file.chunks.reduce(
      (sum, chunk) => sum + chunk.lines.length,
      0
    );
    complexity += linesChanged;

    // Depth of changes
    const maxNesting = this.calculateMaxNesting(file);
    complexity += maxNesting * 10;

    // Critical patterns
    if (this.containsSecurityPatterns(file)) {
      complexity += 50;
    }

    return complexity;
  }
}
```

### 7.3 Parallel Processing

```typescript
// src/core/review/parallel-reviewer.ts
export class ParallelReviewer {
  async reviewFiles(
    files: DiffFile[],
    context: ReviewContext,
    options: ReviewOptions
  ): Promise<ReviewResults> {
    // Split into batches
    const batchSize = 5;
    const batches = this.createBatches(files, batchSize);

    const allIssues: ReviewIssue[] = [];

    for (const batch of batches) {
      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(file => this.reviewFile(file, context, options))
      );

      batchResults.forEach(result => {
        allIssues.push(...result.issues);
      });
    }

    return {
      issues: allIssues,
      filesReviewed: files.length,
      timestamp: Date.now(),
    };
  }

  private async reviewFile(
    file: DiffFile,
    context: ReviewContext,
    options: ReviewOptions
  ): Promise<ReviewResults> {
    // Run analyzers in parallel via Mastra
    const analyzerResults = await Promise.all([
      options.analyzers.includes('logic')
        ? agents.logicAnalyzer.generate({ file, context })
        : Promise.resolve([]),
      options.analyzers.includes('security')
        ? agents.securityAnalyzer.generate({ file, context })
        : Promise.resolve([]),
      options.analyzers.includes('performance')
        ? agents.performanceAnalyzer.generate({ file, context })
        : Promise.resolve([]),
      options.analyzers.includes('patterns')
        ? agents.patternAnalyzer.generate({ file, context })
        : Promise.resolve([]),
    ]);

    const issues = analyzerResults.flat();

    return {
      issues,
      filesReviewed: 1,
      timestamp: Date.now(),
    };
  }
}
```

---

## Phase 8: Configuration & Profiles

**Goal:** Flexible, project-specific review settings

### 8.1 Configuration Schema

```typescript
// src/config/review-config.ts
export interface ReviewConfig {
  // Review behavior
  severity: {
    minimum: 'critical' | 'high' | 'medium' | 'low' | 'info';
    failOn?: 'critical' | 'high' | 'medium'; // Exit with error if found
  };

  analyzers: {
    logic: { enabled: boolean; strictness: number; }; // 0-1
    security: { enabled: boolean; checks: string[]; };
    performance: { enabled: boolean; thresholds: { complexity: number; }; };
    patterns: { enabled: boolean; customRules: string[]; };
  };

  // Fix behavior
  autoFix: {
    enabled: boolean;
    safeOnly: boolean; // Only apply high-confidence fixes
    require: 'always' | 'prompt' | 'never';
  };

  // File filtering
  include: string[]; // Glob patterns
  exclude: string[]; // Glob patterns

  // Language-specific settings
  languages: {
    [lang: string]: {
      enabled: boolean;
      style?: string; // 'airbnb', 'google', etc.
      customRules?: string[];
    };
  };

  // Memory & learning
  memory: {
    enabled: boolean;
    learnFromFeedback: boolean;
    shareAcrossRepos: boolean;
  };

  // Performance
  cache: {
    enabled: boolean;
    ttl: number;
  };

  // Output
  output: {
    format: 'text' | 'json' | 'markdown';
    verbose: boolean;
    groupBy: 'severity' | 'type' | 'file';
  };
}
```

### 8.2 Profile Presets

```typescript
// src/config/profiles/presets.ts
export const REVIEW_PROFILES = {
  strict: {
    severity: { minimum: 'low', failOn: 'medium' },
    analyzers: {
      logic: { enabled: true, strictness: 0.9 },
      security: { enabled: true, checks: ['all'] },
      performance: { enabled: true, thresholds: { complexity: 5 } },
      patterns: { enabled: true, customRules: [] },
    },
    autoFix: { enabled: false, safeOnly: true, require: 'prompt' },
  },

  balanced: {
    severity: { minimum: 'medium', failOn: 'critical' },
    analyzers: {
      logic: { enabled: true, strictness: 0.7 },
      security: { enabled: true, checks: ['critical', 'high'] },
      performance: { enabled: true, thresholds: { complexity: 10 } },
      patterns: { enabled: true, customRules: [] },
    },
    autoFix: { enabled: true, safeOnly: true, require: 'prompt' },
  },

  relaxed: {
    severity: { minimum: 'high', failOn: 'critical' },
    analyzers: {
      logic: { enabled: true, strictness: 0.5 },
      security: { enabled: true, checks: ['critical'] },
      performance: { enabled: false, thresholds: { complexity: 15 } },
      patterns: { enabled: false, customRules: [] },
    },
    autoFix: { enabled: true, safeOnly: true, require: 'always' },
  },

  security: {
    severity: { minimum: 'info', failOn: 'high' },
    analyzers: {
      logic: { enabled: false, strictness: 0.5 },
      security: { enabled: true, checks: ['all'] },
      performance: { enabled: false, thresholds: { complexity: 20 } },
      patterns: { enabled: false, customRules: [] },
    },
    autoFix: { enabled: false, safeOnly: true, require: 'prompt' },
  },
};
```

### 8.3 Configuration Files

```typescript
// .scout-review.json (project root)
{
  "profile": "balanced",
  "extends": ["./custom-rules.json"],
  "analyzers": {
    "security": {
      "checks": ["sql-injection", "xss", "secrets", "auth"]
    }
  },
  "exclude": ["**/*.test.ts", "dist/**", "node_modules/**"],
  "languages": {
    "typescript": {
      "style": "airbnb",
      "customRules": ["./ts-rules.json"]
    },
    "python": {
      "style": "pep8"
    }
  }
}
```

---

## Phase 9: Statistics & Reporting

**Goal:** Track review effectiveness and improvement

### 9.1 Review Metrics

```typescript
// src/core/review/metrics.ts
export class ReviewMetrics {
  async trackReview(results: ReviewResults): Promise<void> {
    await this.redis.incr('metrics:reviews:total');
    await this.redis.incrBy('metrics:issues:total', results.issues.length);

    // By severity
    for (const issue of results.issues) {
      await this.redis.incr(`metrics:issues:${issue.severity}`);
      await this.redis.incr(`metrics:issues:type:${issue.type}`);
    }

    // Timing
    await this.redis.lpush('metrics:duration', results.duration);
  }

  async trackFeedback(issue: ReviewIssue, action: string): Promise<void> {
    await this.redis.incr(`metrics:feedback:${action}`);

    // Track per analyzer
    const analyzer = this.inferAnalyzer(issue);
    await this.redis.incr(`metrics:analyzer:${analyzer}:${action}`);

    // Calculate acceptance rate
    const total = await this.redis.get(`metrics:analyzer:${analyzer}:total`) || 0;
    const accepted = await this.redis.get(`metrics:analyzer:${analyzer}:accepted`) || 0;
    const rate = (accepted / total) * 100;

    await this.redis.set(`metrics:analyzer:${analyzer}:acceptance_rate`, rate);
  }

  async getStats(): Promise<ReviewStats> {
    return {
      total: await this.redis.get('metrics:reviews:total'),
      issues: {
        total: await this.redis.get('metrics:issues:total'),
        critical: await this.redis.get('metrics:issues:critical'),
        high: await this.redis.get('metrics:issues:high'),
        medium: await this.redis.get('metrics:issues:medium'),
        low: await this.redis.get('metrics:issues:low'),
      },
      feedback: {
        accepted: await this.redis.get('metrics:feedback:accepted'),
        modified: await this.redis.get('metrics:feedback:modified'),
        skipped: await this.redis.get('metrics:feedback:skipped'),
        suppressed: await this.redis.get('metrics:feedback:suppressed'),
      },
      analyzers: await this.getAnalyzerStats(),
      averageDuration: await this.calculateAverageDuration(),
      cacheHitRate: await this.calculateCacheHitRate(),
    };
  }
}
```

### 9.2 Enhanced Stats Command

```typescript
// src/cli/stats.ts extension
export function enhanceStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show review statistics and performance metrics')
    .option('--reset', 'Reset all statistics')
    .option('--export <path>', 'Export statistics to JSON file')
    .action(async (options) => {
      const metrics = new ReviewMetrics(redis);
      const stats = await metrics.getStats();

      // Display overview
      console.log(chalk.bold('\n📊 Scout Review Statistics\n'));

      const overviewTable = new Table({
        head: ['Metric', 'Value'],
        style: { head: ['cyan'] },
      });

      overviewTable.push(
        ['Total Reviews', stats.total],
        ['Total Issues Found', stats.issues.total],
        ['Average Duration', `${stats.averageDuration}s`],
        ['Cache Hit Rate', `${stats.cacheHitRate}%`],
      );

      console.log(overviewTable.toString());

      // Issues by severity
      console.log(chalk.bold('\n🔍 Issues by Severity\n'));
      const severityTable = new Table({
        head: ['Severity', 'Count', 'Percentage'],
        style: { head: ['cyan'] },
      });

      const total = stats.issues.total;
      severityTable.push(
        ['Critical', stats.issues.critical, `${((stats.issues.critical / total) * 100).toFixed(1)}%`],
        ['High', stats.issues.high, `${((stats.issues.high / total) * 100).toFixed(1)}%`],
        ['Medium', stats.issues.medium, `${((stats.issues.medium / total) * 100).toFixed(1)}%`],
        ['Low', stats.issues.low, `${((stats.issues.low / total) * 100).toFixed(1)}%`],
      );

      console.log(severityTable.toString());

      // Analyzer performance
      console.log(chalk.bold('\n⚡ Analyzer Performance\n'));
      const analyzerTable = new Table({
        head: ['Analyzer', 'Issues Found', 'Acceptance Rate', 'Avg Duration'],
        style: { head: ['cyan'] },
      });

      for (const [name, data] of Object.entries(stats.analyzers)) {
        analyzerTable.push([
          name,
          data.issuesFound,
          `${data.acceptanceRate.toFixed(1)}%`,
          `${data.avgDuration}s`,
        ]);
      }

      console.log(analyzerTable.toString());

      // Feedback summary
      console.log(chalk.bold('\n👍 Feedback Summary\n'));
      const feedbackTable = new Table({
        head: ['Action', 'Count', 'Percentage'],
        style: { head: ['cyan'] },
      });

      const feedbackTotal =
        stats.feedback.accepted +
        stats.feedback.modified +
        stats.feedback.skipped +
        stats.feedback.suppressed;

      feedbackTable.push(
        ['Accepted', stats.feedback.accepted, `${((stats.feedback.accepted / feedbackTotal) * 100).toFixed(1)}%`],
        ['Modified', stats.feedback.modified, `${((stats.feedback.modified / feedbackTotal) * 100).toFixed(1)}%`],
        ['Skipped', stats.feedback.skipped, `${((stats.feedback.skipped / feedbackTotal) * 100).toFixed(1)}%`],
        ['Suppressed', stats.feedback.suppressed, `${((stats.feedback.suppressed / feedbackTotal) * 100).toFixed(1)}%`],
      );

      console.log(feedbackTable.toString());

      // Export if requested
      if (options.export) {
        await fs.writeFile(options.export, JSON.stringify(stats, null, 2));
        console.log(chalk.green(`\n✓ Statistics exported to ${options.export}`));
      }

      // Reset if requested
      if (options.reset) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to reset all statistics?',
            default: false,
          },
        ]);

        if (confirm) {
          await metrics.reset();
          console.log(chalk.green('\n✓ Statistics reset'));
        }
      }
    });
}
```

---

## Implementation Timeline

### Week 1-2: Foundation & LLM Integration
- [ ] Set up Mastra with multi-provider support
- [ ] Create agent configurations for each analyzer type
- [ ] Implement provider abstraction layer
- [ ] Build prompt template system
- [ ] Extend configuration schema

### Week 3-4: Git & Review Engine Core
- [ ] Enhanced git utilities and diff parsing
- [ ] Change analyzer for complexity detection
- [ ] Build Mastra workflows (full, quick, security)
- [ ] Context builder with Moss integration
- [ ] Issue classification and ranking system

### Week 5-6: Morph Integration & Fixes
- [ ] Integrate Morph client for code modifications
- [ ] Interactive fix application system
- [ ] Diff preview and staging
- [ ] Batch fix application
- [ ] Feedback collection mechanism

### Week 7-8: Memory & Learning
- [ ] Set up Hyperspell client and schema
- [ ] Implement memory operations (store, query, learn)
- [ ] Build learning system for convention extraction
- [ ] Repo profile generation
- [ ] Cross-session pattern recognition

### Week 9-10: CLI & User Experience
- [ ] Main `review` command with all options
- [ ] `explain`, `suggest`, `learn` commands
- [ ] Beautiful terminal formatters
- [ ] Watch mode with file monitoring
- [ ] Interactive prompts and confirmations

### Week 11-12: Performance & Optimization
- [ ] Multi-layer caching strategy
- [ ] Scope optimizer for smart reviews
- [ ] Parallel processing for multiple files
- [ ] Incremental review support
- [ ] Background indexing

### Week 13-14: Polish & Documentation
- [ ] Configuration profiles and presets
- [ ] Review metrics and statistics
- [ ] Enhanced stats command
- [ ] Comprehensive documentation
- [ ] Example configurations and workflows

### Week 15-16: Testing & Refinement
- [ ] End-to-end testing on real codebases
- [ ] Performance benchmarking
- [ ] False positive rate analysis
- [ ] User acceptance testing
- [ ] Bug fixes and refinements

---

## Dependencies to Add

```json
{
  "dependencies": {
    "@mastra/core": "^latest",
    "@morph-labs/morph": "^latest",
    "hyperspell": "^latest",
    "@anthropic-ai/sdk": "^latest",
    "openai": "^latest",
    "ollama": "^latest",
    "diff-parse": "^latest",
    "inquirer": "^latest",
    "ora": "^latest",
    "chalk": "^4.1.2",
    "cli-table3": "^latest",
    "diff": "^latest",
    "node-notifier": "^latest"
  }
}
```

---

## Success Metrics

### Performance Targets
- ✅ Review speed: <5s for typical changes (1-5 files)
- ✅ Cache hit rate: >60% for repeated patterns
- ✅ Parallel efficiency: 3-5x speedup for multi-file reviews

### Accuracy Targets
- ✅ Bug detection rate: 80%+ (measured on known bug datasets)
- ✅ False positive rate: <20% (based on user feedback)
- ✅ Fix acceptance rate: >50% (after learning period)

### User Experience Targets
- ✅ Helpful feedback rate: >70% (based on user feedback)
- ✅ Time to first issue: <3s
- ✅ Learning curve: Useful results from day 1

---

## Migration Strategy

### Backwards Compatibility
- ✅ Keep all existing commands (`index`, `chat`, `serve`, `stats`)
- ✅ Existing users unaffected - review features additive
- ✅ Shared infrastructure (Moss, Redis, config) works seamlessly

### Gradual Rollout
1. **Phase 1**: Beta release with `review` command (opt-in)
2. **Phase 2**: Gather feedback, tune analyzers
3. **Phase 3**: Promote review features in documentation
4. **Phase 4**: Consider making review the primary use case

### Branding Evolution
- Current: "Scout Code - Blazingly fast code search"
- Future: "Scout Code - AI-powered code review & search"

---

## Key Technical Advantages

### Reusing Existing Infrastructure (40% head start)
1. **Moss Semantic Search**: Ready for pattern matching and similar code detection
2. **Redis Caching**: Perfect for review result caching
3. **Incremental Indexing**: Efficient change detection already implemented
4. **MCP Server**: VS Code extension ready out of the box
5. **Multi-repo Support**: Cross-repo learning built-in

### New Capabilities with Mastra + Morph
1. **Intelligent Orchestration**: Mastra handles complex multi-agent workflows
2. **LLM-Powered Fixes**: Morph applies diffs with AI understanding
3. **Local-First**: Can run fully offline with Ollama + local Hyperspell
4. **Continuous Learning**: Hyperspell enables repo-specific improvement

### Competitive Differentiation
- **Speed**: Local-first + caching = fastest reviews
- **Intelligence**: Multi-agent system catches more bugs
- **Learning**: Gets smarter with each review via Hyperspell
- **Flexibility**: Multi-LLM support, runs fully local or cloud
- **Integration**: CLI-first, but MCP-ready for VS Code

---

## Risk Mitigation

### Technical Risks
- **LLM API costs**: Mitigated by caching, local models, incremental reviews
- **False positives**: Addressed by confidence scoring, learning system
- **Performance**: Parallel processing, smart scoping, aggressive caching

### User Experience Risks
- **Learning curve**: Sane defaults, profiles, interactive prompts
- **Noise**: Severity filtering, confidence thresholds, feedback loop
- **Trust**: Transparency in rationale, references, opt-in fixes

### Business Risks
- **Market fit**: Interactive CLI fills gap between linters and PR bots
- **Competition**: Local-first + learning system is unique positioning
- **Adoption**: Leverage existing Scout Code users, gradual rollout

---

## Future Enhancements (Post-MVP)

### Platform Integrations
- GitHub Action for CI/CD reviews
- GitLab CI integration
- Pre-commit hook generation
- VS Code extension via MCP

### Advanced Features
- Code quality trends over time
- Team-wide learning and conventions
- Custom analyzer creation (low-code)
- Review templates for common patterns

### Enterprise Features
- Self-hosted Hyperspell for data privacy
- SSO integration
- Audit logs and compliance reporting
- Team dashboards and analytics

---

## Conclusion

This pivot transforms Scout Code from a search tool into a **comprehensive AI-powered code review system** while leveraging 40% of the existing infrastructure. The combination of:

- **Mastra** for intelligent agent orchestration
- **Morph** for LLM-powered code fixes
- **Moss** for semantic code understanding (existing)
- **Hyperspell** for repo-specific learning
- **Multi-LLM support** for flexibility

...creates a **unique, local-first, continuously learning code review bot** that gets better with every review.

The interactive CLI approach fills a gap between static linters (too dumb) and PR review bots (too slow), providing **real-time, intelligent feedback** during development.

**Estimated Time to MVP**: 12-16 weeks with focused development.

**Key Differentiator**: The only code review tool that learns your codebase's specific patterns and conventions while running locally-first.
