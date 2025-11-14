/**
 * Context Enricher - Main engine for gathering comprehensive code context
 * Combines static analysis, semantic search, and dependency graphs
 */

import { promises as fs } from 'fs';
import path from 'path';
import { DependencyGraphBuilder, DependencyNode, TestFile } from './dependency-graph.js';
import { EnrichedContext } from './context-strategies.js';
import { logger } from '../../utils/logger.js';
import { MossClient } from '../indexer/moss-client.js';
import { execSync } from 'child_process';

export interface ContextEnricherOptions {
  repoPath: string;
  repoName: string;
  maxSimilarPatterns?: number;
  maxImportDepth?: number;
  includeTests?: boolean;
}

export interface ImportInfo {
  importPath: string;
  importedNames: string[];
  resolvedPath: string;
  definition: string;
}

export interface TypeInfo {
  name: string;
  definition: string;
  source: string;
}

/**
 * Main context enrichment engine
 */
export class ContextEnricher {
  private depGraphBuilder: DependencyGraphBuilder | null = null;
  private mossClient: MossClient | null = null;
  private options: Required<ContextEnricherOptions>;
  private fileCache: Map<string, string> = new Map();

  constructor(options: ContextEnricherOptions) {
    this.options = {
      maxSimilarPatterns: 5,
      maxImportDepth: 1,
      includeTests: true,
      ...options,
    };
  }

  /**
   * Lazy initialization of MossClient - loads credentials from backend
   */
  private async getMossClient(): Promise<MossClient> {
    if (this.mossClient) {
      return this.mossClient;
    }

    // Load config (which fetches credentials from backend)
    const { loadConfig } = await import('../../config/loader.js');
    const config = await loadConfig();

    this.mossClient = new MossClient(
      config.moss.project_id,
      config.moss.project_key,
      config.moss.index_directory
    );

    return this.mossClient;
  }

  /**
   * Lazy initialization of DependencyGraphBuilder with MossClient
   */
  private async getDepGraphBuilder(): Promise<DependencyGraphBuilder> {
    if (this.depGraphBuilder) {
      return this.depGraphBuilder;
    }

    const mossClient = await this.getMossClient();
    this.depGraphBuilder = new DependencyGraphBuilder(
      this.options.repoPath,
      this.options.repoName,
      mossClient
    );

    return this.depGraphBuilder;
  }

  /**
   * Enrich context for a file being reviewed
   */
  async enrich(input: {
    fileName: string;
    changedCode: string;
    language: string;
    fullFilePath: string;
  }): Promise<EnrichedContext> {
    logger.info(`[ContextEnricher] Starting enrichment for ${input.fileName}`);
    const startTime = Date.now();

    try {
      // Read full file content
      logger.debug(`[ContextEnricher] Reading file: ${input.fullFilePath}`);
      const fullContent = await this.readFile(input.fullFilePath);
      logger.debug(`[ContextEnricher] File read complete (${fullContent.length} chars)`);

      // Initialize dependency graph builder with MossClient
      const depGraphBuilder = await this.getDepGraphBuilder();

      // Run all enrichment steps in parallel for speed
      logger.debug(`[ContextEnricher] Starting parallel enrichment steps`);
      const [
        imports,
        types,
        similarPatterns,
        depGraph,
      ] = await Promise.all([
        this.extractImports(fullContent, input.fullFilePath, input.language),
        this.extractTypes(fullContent, input.fullFilePath, input.language),
        this.findSimilarPatterns(input.changedCode, input.language, input.fileName),
        depGraphBuilder.buildGraph(input.fullFilePath, {
          maxDepth: this.options.maxImportDepth,
          includeTests: this.options.includeTests,
        }),
      ]);

      logger.debug(`[ContextEnricher] All enrichment steps completed`);

      const enrichedContext: EnrichedContext = {
        fileName: input.fileName,
        changedCode: input.changedCode,
        language: input.language,
        fullContent,
        imports,
        typeDefinitions: types,
        similarPatterns,
        dependencies: {
          upstream: depGraph.upstream.map((dep) => ({
            filePath: dep.filePath,
            depth: dep.depth,
            exports: dep.exports,
          })),
          downstream: depGraph.downstream.map((dep) => ({
            filePath: dep.filePath,
            depth: dep.depth,
          })),
        },
        relatedTests: depGraph.tests.map((test) => ({
          filePath: test.filePath,
          testNames: test.testNames,
        })),
      };

      const duration = Date.now() - startTime;
      logger.info(
        `[ContextEnricher] Context enriched for ${input.fileName} in ${duration}ms: ` +
        `${imports.length} imports, ${types.length} types, ` +
        `${similarPatterns.length} patterns, ${depGraph.upstream.length} upstream deps, ` +
        `${depGraph.downstream.length} downstream deps, ${depGraph.tests.length} tests`
      );

      return enrichedContext;
    } catch (error) {
      logger.error(`Error enriching context for ${input.fileName}:`, error);

      // Return minimal context on error
      return {
        fileName: input.fileName,
        changedCode: input.changedCode,
        language: input.language,
        imports: [],
        typeDefinitions: [],
        similarPatterns: [],
        dependencies: { upstream: [], downstream: [] },
        relatedTests: [],
      };
    }
  }

  /**
   * Extract and resolve imports from file
   */
  private async extractImports(
    content: string,
    filePath: string,
    language: string
  ): Promise<ImportInfo[]> {
    logger.debug(`[ContextEnricher] Extracting imports from ${filePath}`);
    const imports: ImportInfo[] = [];

    try {
      // Extract import statements
      const importStatements = this.parseImportStatements(content, language);
      logger.debug(`[ContextEnricher] Found ${importStatements.length} import statements`);

      for (const stmt of importStatements) {
        // Resolve import path
        logger.debug(`[ContextEnricher] Resolving import: ${stmt.path}`);
        const resolvedPath = await this.resolveImportPath(stmt.path, filePath);

        if (resolvedPath) {
          logger.debug(`[ContextEnricher] Resolved to: ${resolvedPath}`);
          // Read the imported file
          const importedContent = await this.readFile(resolvedPath);

          // Extract relevant definitions
          const definition = this.extractRelevantDefinitions(
            importedContent,
            stmt.names,
            language
          );

          imports.push({
            importPath: stmt.path,
            importedNames: stmt.names,
            resolvedPath,
            definition,
          });
        } else {
          logger.debug(`[ContextEnricher] Could not resolve import: ${stmt.path} (likely external package)`);
        }
      }

      logger.debug(`[ContextEnricher] Successfully extracted ${imports.length} imports`);
    } catch (error) {
      logger.warn(`[ContextEnricher] Error extracting imports from ${filePath}:`, error);
    }

    return imports;
  }

  /**
   * Parse import statements from code
   */
  private parseImportStatements(
    content: string,
    language: string
  ): Array<{ path: string; names: string[] }> {
    const statements: Array<{ path: string; names: string[] }> = [];

    // ES6 named imports: import { foo, bar } from 'path'
    const namedImportPattern = /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = namedImportPattern.exec(content)) !== null) {
      const names = match[1]
        .split(',')
        .map((n) => n.trim().split(/\s+as\s+/)[0].trim())
        .filter((n) => n.length > 0);
      statements.push({ path: match[2], names });
    }

    // ES6 default imports: import foo from 'path'
    const defaultImportPattern = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = defaultImportPattern.exec(content)) !== null) {
      statements.push({ path: match[2], names: [match[1]] });
    }

    // ES6 namespace imports: import * as foo from 'path'
    const namespacePattern = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = namespacePattern.exec(content)) !== null) {
      statements.push({ path: match[2], names: [match[1]] });
    }

    // Require statements: const foo = require('path')
    const requirePattern = /(?:const|let|var)\s+(?:{([^}]+)}|(\w+))\s*=\s*require\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = requirePattern.exec(content)) !== null) {
      const names = match[1]
        ? match[1].split(',').map((n) => n.trim())
        : [match[2]];
      statements.push({ path: match[3], names });
    }

    return statements;
  }

  /**
   * Resolve import path using right-to-left grep approach
   */
  private async resolveImportPath(importPath: string, fromFile: string): Promise<string | null> {
    logger.debug(`[ContextEnricher] resolveImportPath called for: "${importPath}"`);

    // Skip obvious external packages (no @ or . prefix)
    if (!importPath.startsWith('@') && !importPath.startsWith('.') && !importPath.startsWith('/')) {
      logger.debug(`[ContextEnricher] "${importPath}" is external package (no @/./ prefix)`);
      return null;
    }

    // Extract base filename from import path
    // e.g., "@/services/wallet.service" → "wallet.service"
    // e.g., "./utils/helper" → "helper"
    const parts = importPath.split('/');
    const baseFileName = parts[parts.length - 1];

    logger.debug(`[ContextEnricher] Extracted base filename: "${baseFileName}"`);

    // File extensions to try (TypeScript/JavaScript)
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    // Try to find file using grep (right-to-left approach)
    for (const ext of extensions) {
      const searchPattern = `${baseFileName}${ext}`;
      logger.debug(`[ContextEnricher] Trying extension: ${ext}`);
      logger.debug(`[ContextEnricher] Searching for: "${searchPattern}"`);

      try {
        // Use find command to locate file in repo
        const cmd = `find "${this.options.repoPath}" -name "${searchPattern}" -type f 2>/dev/null | head -1`;
        logger.debug(`[ContextEnricher] Executing command: ${cmd}`);

        const result = execSync(cmd, { encoding: 'utf-8' }).trim();
        logger.debug(`[ContextEnricher] Command result: ${result ? `"${result}"` : '(empty)'}`);

        if (result) {
          logger.debug(`[ContextEnricher] ✓ Found "${importPath}" → "${result}"`);
          return result;
        } else {
          logger.debug(`[ContextEnricher] No match for ${ext}, continuing to next extension`);
        }
      } catch (error) {
        logger.debug(`[ContextEnricher] Error during find with ${ext}: ${error}`);
      }
    }

    // Also try index files (e.g., @/components/Button → components/Button/index.tsx)
    logger.debug(`[ContextEnricher] Trying index files for "${baseFileName}"`);
    for (const ext of extensions) {
      const searchPattern = `index${ext}`;
      logger.debug(`[ContextEnricher] Trying index with extension: ${ext}`);

      try {
        // Search for index files in a directory matching the last part of the import
        const cmd = `find "${this.options.repoPath}" -path "*/${baseFileName}/index${ext}" -type f 2>/dev/null | head -1`;
        logger.debug(`[ContextEnricher] Executing index command: ${cmd}`);

        const result = execSync(cmd, { encoding: 'utf-8' }).trim();
        logger.debug(`[ContextEnricher] Index command result: ${result ? `"${result}"` : '(empty)'}`);

        if (result) {
          logger.debug(`[ContextEnricher] ✓ Found index file for "${importPath}" → "${result}"`);
          return result;
        } else {
          logger.debug(`[ContextEnricher] No index match for ${ext}, continuing`);
        }
      } catch (error) {
        logger.debug(`[ContextEnricher] Error during index find with ${ext}: ${error}`);
      }
    }

    logger.debug(`[ContextEnricher] ✗ Could not resolve "${importPath}" - likely external package`);
    return null;
  }

  /**
   * Extract relevant definitions from imported file
   */
  private extractRelevantDefinitions(
    content: string,
    importedNames: string[],
    language: string
  ): string {
    const definitions: string[] = [];

    for (const name of importedNames) {
      // Try to extract the definition
      const patterns = [
        // Function: export function foo() or function foo()
        new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\([^)]*\\)[^{]*{[\\s\\S]{0,500}`, 'm'),
        // Class: export class Foo or class Foo
        new RegExp(`(?:export\\s+)?class\\s+${name}\\s+(?:extends\\s+\\w+\\s+)?{[\\s\\S]{0,500}`, 'm'),
        // Interface: export interface Foo
        new RegExp(`(?:export\\s+)?interface\\s+${name}\\s+{[\\s\\S]{0,500}`, 'm'),
        // Type: export type Foo =
        new RegExp(`(?:export\\s+)?type\\s+${name}\\s*=[\\s\\S]{0,300}`, 'm'),
        // Const: export const foo =
        new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=[\\s\\S]{0,300}`, 'm'),
        // Enum: export enum Foo
        new RegExp(`(?:export\\s+)?enum\\s+${name}\\s+{[\\s\\S]{0,300}`, 'm'),
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          definitions.push(match[0].trim());
          break;
        }
      }
    }

    return definitions.length > 0
      ? definitions.join('\n\n')
      : `// Definitions for: ${importedNames.join(', ')}`;
  }

  /**
   * Extract type definitions from file
   */
  private async extractTypes(
    content: string,
    filePath: string,
    language: string
  ): Promise<TypeInfo[]> {
    logger.debug(`[ContextEnricher] Extracting types from ${filePath}`);

    if (!['typescript', 'tsx', 'ts'].includes(language.toLowerCase())) {
      logger.debug(`[ContextEnricher] Skipping type extraction (not TypeScript)`);
      return [];
    }

    const types: TypeInfo[] = [];

    // Extract interfaces
    const interfacePattern = /(?:export\s+)?interface\s+(\w+)\s*(?:extends\s+[\w,\s]+)?{[\s\S]{0,500}?}/gm;
    let match;
    let interfaceCount = 0;
    while ((match = interfacePattern.exec(content)) !== null) {
      types.push({
        name: match[1],
        definition: match[0],
        source: filePath,
      });
      interfaceCount++;
    }

    // Extract type aliases
    const typePattern = /(?:export\s+)?type\s+(\w+)\s*=[\s\S]{0,300}?(?:;|\n)/gm;
    let typeCount = 0;
    while ((match = typePattern.exec(content)) !== null) {
      types.push({
        name: match[1],
        definition: match[0],
        source: filePath,
      });
      typeCount++;
    }

    // Extract enums
    const enumPattern = /(?:export\s+)?enum\s+(\w+)\s*{[\s\S]{0,300}?}/gm;
    let enumCount = 0;
    while ((match = enumPattern.exec(content)) !== null) {
      types.push({
        name: match[1],
        definition: match[0],
        source: filePath,
      });
      enumCount++;
    }

    logger.debug(
      `[ContextEnricher] Extracted ${types.length} types: ` +
      `${interfaceCount} interfaces, ${typeCount} type aliases, ${enumCount} enums`
    );

    return types;
  }

  /**
   * Find similar code patterns using Moss semantic search
   */
  private async findSimilarPatterns(
    code: string,
    language: string,
    currentFile: string
  ): Promise<Array<{ filePath: string; code: string; similarity: number }>> {
    logger.debug(`[ContextEnricher] Finding similar patterns for ${currentFile}`);

    try {
      // Extract a meaningful query from the changed code
      const query = this.extractSemanticQuery(code);

      if (!query) {
        logger.debug(`[ContextEnricher] No meaningful query extracted from code`);
        return [];
      }

      logger.debug(`[ContextEnricher] Searching Moss with query: "${query.substring(0, 50)}..."`);

      // Search Moss index
      const mossClient = await this.getMossClient();
      const searchResults = await mossClient.search({
        query,
        repos: [this.options.repoName],
        max_results: this.options.maxSimilarPatterns * 2, // Get more, filter later
        file_types: this.getFileExtensions(language),
      });

      logger.debug(`[ContextEnricher] Moss returned ${searchResults.results.length} results`);

      // Convert results to similar patterns
      const patterns = searchResults.results
        .filter((result) => {
          // Exclude the current file
          return !result.file_path?.includes(currentFile);
        })
        .map((result) => ({
          filePath: result.file_path || '',
          code: result.content || '',
          similarity: result.score || 0,
        }))
        .slice(0, this.options.maxSimilarPatterns);

      logger.debug(`[ContextEnricher] Found ${patterns.length} similar patterns after filtering`);

      return patterns;
    } catch (error) {
      // Silently fail if index doesn't exist or search fails
      // This is expected when the repo hasn't been indexed yet
      logger.debug('[ContextEnricher] Moss search failed (repo may not be indexed):', error);
      return [];
    }
  }

  /**
   * Extract semantic query from code
   */
  private extractSemanticQuery(code: string): string {
    // Remove comments
    let query = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

    // Extract function signatures if present
    const funcMatch = query.match(/(?:function|const|let|var)\s+(\w+)\s*[=\(]/);
    if (funcMatch) {
      return `${funcMatch[1]} function`;
    }

    // Extract class names
    const classMatch = query.match(/class\s+(\w+)/);
    if (classMatch) {
      return `${classMatch[1]} class`;
    }

    // Use first meaningful line
    const lines = query.split('\n').filter((l) => l.trim().length > 10);
    if (lines.length > 0) {
      return lines[0].trim().substring(0, 100);
    }

    return code.substring(0, 100);
  }

  /**
   * Get file extensions for language
   */
  private getFileExtensions(language: string): string[] {
    const extMap: Record<string, string[]> = {
      typescript: ['ts', 'tsx'],
      javascript: ['js', 'jsx'],
      python: ['py'],
      rust: ['rs'],
      go: ['go'],
      java: ['java'],
    };

    return extMap[language.toLowerCase()] || [language.toLowerCase()];
  }

  /**
   * Read file with caching
   */
  private async readFile(filePath: string): Promise<string> {
    if (this.fileCache.has(filePath)) {
      return this.fileCache.get(filePath)!;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    this.fileCache.set(filePath, content);
    return content;
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.fileCache.clear();
    if (this.depGraphBuilder) {
      this.depGraphBuilder.clearCache();
    }
  }
}
