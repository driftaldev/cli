/**
 * Dependency graph builder for code review context
 * Analyzes import relationships and builds dependency trees
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';
import { execSync } from 'child_process';

export interface DependencyNode {
  filePath: string;
  imports: string[]; // Resolved file paths
  exports: string[]; // Export names
  depth: number;
  relationship: 'upstream' | 'downstream' | 'self';
}

export interface TestFile {
  filePath: string;
  relatedFile: string;
  testNames: string[];
}

export interface DependencyGraphOptions {
  maxDepth?: number;
  includeTests?: boolean;
  includeNodeModules?: boolean;
}

/**
 * Builds and analyzes dependency graphs for code files
 */
export class DependencyGraphBuilder {
  private repoPath: string;
  private fileCache: Map<string, string> = new Map();

  constructor(repoPath: string, repoName?: string) {
    this.repoPath = repoPath;
  }

  /**
   * Build dependency graph for a file
   */
  async buildGraph(
    filePath: string,
    options: DependencyGraphOptions = {}
  ): Promise<{
    upstream: DependencyNode[];
    downstream: DependencyNode[];
    tests: TestFile[];
  }> {
    const { maxDepth = 2, includeTests = true, includeNodeModules = false } = options;
    logger.debug(`[DependencyGraph] Building graph for ${filePath} (maxDepth=${maxDepth})`);
    const startTime = Date.now();

    try {
      // Get upstream dependencies (what this file imports)
      logger.debug(`[DependencyGraph] Finding upstream dependencies...`);
      const upstream = await this.getUpstreamDependencies(filePath, maxDepth, includeNodeModules);
      logger.debug(`[DependencyGraph] Found ${upstream.length} upstream dependencies`);

      // Get downstream dependencies (what imports this file)
      logger.debug(`[DependencyGraph] Finding downstream dependencies...`);
      const downstream = await this.getDownstreamDependencies(filePath, maxDepth);
      logger.debug(`[DependencyGraph] Found ${downstream.length} downstream dependencies`);

      // Find related tests
      const tests = includeTests ? await this.findRelatedTests(filePath) : [];
      logger.debug(`[DependencyGraph] Found ${tests.length} related test files`);

      const duration = Date.now() - startTime;
      logger.debug(
        `[DependencyGraph] Graph built in ${duration}ms: ` +
        `${upstream.length} upstream, ${downstream.length} downstream, ${tests.length} tests`
      );

      return { upstream, downstream, tests };
    } catch (error) {
      logger.error(`[DependencyGraph] Error building dependency graph for ${filePath}:`, error);
      return { upstream: [], downstream: [], tests: [] };
    }
  }

  /**
   * Get upstream dependencies (files this imports from)
   */
  private async getUpstreamDependencies(
    filePath: string,
    maxDepth: number,
    includeNodeModules: boolean
  ): Promise<DependencyNode[]> {
    const visited = new Set<string>();
    const dependencies: DependencyNode[] = [];

    const traverse = async (currentPath: string, depth: number) => {
      if (depth > maxDepth || visited.has(currentPath)) {
        return;
      }

      visited.add(currentPath);

      try {
        const content = await this.readFile(currentPath);
        const imports = this.extractImports(content, currentPath);
        const resolvedImports = await this.resolveImports(imports, currentPath, includeNodeModules);

        if (depth > 0) {
          dependencies.push({
            filePath: currentPath,
            imports: resolvedImports.map((imp) => imp.resolvedPath),
            exports: this.extractExports(content),
            depth,
            relationship: 'upstream',
          });
        }

        // Recursively traverse imports
        for (const imp of resolvedImports) {
          await traverse(imp.resolvedPath, depth + 1);
        }
      } catch (error) {
        // File might not exist or be readable, skip
      }
    };

    await traverse(filePath, 0);
    return dependencies;
  }

  /**
   * Get downstream dependencies (files that import this)
   */
  private async getDownstreamDependencies(
    filePath: string,
    maxDepth: number
  ): Promise<DependencyNode[]> {
    // This is more expensive - need to search all files
    // For performance, we'll limit to same directory and parent directory
    const dependencies: DependencyNode[] = [];
    const searchDirs = [
      path.dirname(filePath),
      path.dirname(path.dirname(filePath)),
    ];

    const relativePath = path.relative(this.repoPath, filePath);

    for (const dir of searchDirs) {
      try {
        const files = await this.getAllFiles(dir, ['.ts', '.tsx', '.js', '.jsx']);

        for (const file of files) {
          if (file === filePath) continue;

          try {
            const content = await this.readFile(file);
            const imports = this.extractImports(content, file);

            // Check if this file imports our target
            for (const imp of imports) {
              const resolved = await this.resolveImportPath(imp, file);
              if (resolved && path.normalize(resolved) === path.normalize(filePath)) {
                dependencies.push({
                  filePath: file,
                  imports: [filePath],
                  exports: this.extractExports(content),
                  depth: 1,
                  relationship: 'downstream',
                });
                break;
              }
            }
          } catch (error) {
            // Skip files that can't be read
          }
        }
      } catch (error) {
        // Skip directories that can't be accessed
      }
    }

    return dependencies;
  }

  /**
   * Find related test files
   */
  private async findRelatedTests(filePath: string): Promise<TestFile[]> {
    logger.debug(`[DependencyGraph] Searching for tests related to ${filePath}`);
    const tests: TestFile[] = [];
    const fileDir = path.dirname(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));

    // Common test patterns
    const testPatterns = [
      `${fileName}.test.ts`,
      `${fileName}.test.js`,
      `${fileName}.spec.ts`,
      `${fileName}.spec.js`,
      `${fileName}.test.tsx`,
      `${fileName}.spec.tsx`,
    ];

    // Check same directory
    for (const pattern of testPatterns) {
      const testPath = path.join(fileDir, pattern);
      if (await this.fileExists(testPath)) {
        logger.debug(`[DependencyGraph] Found test file: ${testPath}`);
        const testNames = await this.extractTestNames(testPath);
        tests.push({
          filePath: testPath,
          relatedFile: filePath,
          testNames,
        });
      }
    }

    // Check __tests__ directory
    const testsDir = path.join(fileDir, '__tests__');
    if (await this.fileExists(testsDir)) {
      logger.debug(`[DependencyGraph] Checking __tests__ directory`);
      for (const pattern of testPatterns) {
        const testPath = path.join(testsDir, pattern);
        if (await this.fileExists(testPath)) {
          logger.debug(`[DependencyGraph] Found test file: ${testPath}`);
          const testNames = await this.extractTestNames(testPath);
          tests.push({
            filePath: testPath,
            relatedFile: filePath,
            testNames,
          });
        }
      }
    }

    return tests;
  }

  /**
   * Extract import statements from code
   */
  private extractImports(content: string, filePath: string): string[] {
    const imports: string[] = [];

    // Match ES6 imports
    const es6Pattern = /import\s+(?:[\w{},\s*]*\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = es6Pattern.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Match require statements
    const requirePattern = /require\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = requirePattern.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Match dynamic imports
    const dynamicPattern = /import\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = dynamicPattern.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return [...new Set(imports)]; // Remove duplicates
  }

  /**
   * Extract export names from code
   */
  private extractExports(content: string): string[] {
    const exports: string[] = [];

    // Named exports: export { foo, bar }
    const namedExportPattern = /export\s+{\s*([^}]+)\s*}/g;
    let match;
    while ((match = namedExportPattern.exec(content)) !== null) {
      const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
      exports.push(...names);
    }

    // Export declarations: export const foo = ...
    const declPattern = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    while ((match = declPattern.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // Default export
    if (/export\s+default/.test(content)) {
      exports.push('default');
    }

    return [...new Set(exports)];
  }

  /**
   * Resolve import paths to actual file paths
   */
  private async resolveImports(
    imports: string[],
    fromFile: string,
    includeNodeModules: boolean
  ): Promise<Array<{ importPath: string; resolvedPath: string }>> {
    const resolved: Array<{ importPath: string; resolvedPath: string }> = [];

    for (const imp of imports) {
      // Skip external modules if not including node_modules
      if (!includeNodeModules) {
        // Skip if it doesn't look like a local import
        if (!imp.startsWith('@') && !imp.startsWith('.') && !imp.startsWith('/')) {
          continue;
        }
      }

      const resolvedPath = await this.resolveImportPath(imp, fromFile);
      if (resolvedPath) {
        resolved.push({ importPath: imp, resolvedPath });
      }
    }

    return resolved;
  }

  /**
   * Resolve a single import path using right-to-left grep approach
   */
  private async resolveImportPath(importPath: string, fromFile: string): Promise<string | null> {
    // Extract base filename from import path
    const parts = importPath.split('/');
    const baseFileName = parts[parts.length - 1];

    logger.debug(`[DependencyGraph] Resolving import: "${importPath}"`);
    logger.debug(`[DependencyGraph] Extracted base filename: "${baseFileName}"`);

    // File extensions to try
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    // Try to find file using find command (right-to-left approach)
    for (const ext of extensions) {
      const searchPattern = `${baseFileName}${ext}`;
      logger.debug(`[DependencyGraph] Trying extension: ${ext}`);
      logger.debug(`[DependencyGraph] Searching for: "${searchPattern}"`);

      try {
        const cmd = `find "${this.repoPath}" -name "${searchPattern}" -type f 2>/dev/null | head -1`;
        logger.debug(`[DependencyGraph] Executing command: ${cmd}`);

        const result = execSync(cmd, { encoding: 'utf-8' }).trim();
        logger.debug(`[DependencyGraph] Command result: ${result ? `"${result}"` : '(empty)'}`);

        if (result) {
          logger.debug(`[DependencyGraph] ✓ Found "${importPath}" → "${result}"`);
          return result;
        } else {
          logger.debug(`[DependencyGraph] No match for ${ext}, continuing to next extension`);
        }
      } catch (error) {
        logger.debug(`[DependencyGraph] Error during find with ${ext}: ${error}`);
      }
    }

    // Also try index files
    logger.debug(`[DependencyGraph] Trying index files for "${baseFileName}"`);
    for (const ext of extensions) {
      logger.debug(`[DependencyGraph] Trying index with extension: ${ext}`);

      try {
        const cmd = `find "${this.repoPath}" -path "*/${baseFileName}/index${ext}" -type f 2>/dev/null | head -1`;
        logger.debug(`[DependencyGraph] Executing index command: ${cmd}`);

        const result = execSync(cmd, { encoding: 'utf-8' }).trim();
        logger.debug(`[DependencyGraph] Index command result: ${result ? `"${result}"` : '(empty)'}`);

        if (result) {
          logger.debug(`[DependencyGraph] ✓ Found index file for "${importPath}" → "${result}"`);
          return result;
        } else {
          logger.debug(`[DependencyGraph] No index match for ${ext}, continuing`);
        }
      } catch (error) {
        logger.debug(`[DependencyGraph] Error during index find with ${ext}: ${error}`);
      }
    }

    logger.debug(`[DependencyGraph] ✗ Could not resolve "${importPath}"`);
    return null;
  }

  /**
   * Extract test names from test file
   */
  private async extractTestNames(testPath: string): Promise<string[]> {
    try {
      const content = await this.readFile(testPath);
      const testNames: string[] = [];

      // Match test/it blocks
      const testPattern = /(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
      let match;
      while ((match = testPattern.exec(content)) !== null) {
        testNames.push(match[1]);
      }

      // Match describe blocks
      const describePattern = /describe\s*\(\s*['"`]([^'"`]+)['"`]/g;
      while ((match = describePattern.exec(content)) !== null) {
        testNames.push(`[Suite] ${match[1]}`);
      }

      return testNames;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get all files in directory recursively
   */
  private async getAllFiles(dir: string, extensions: string[]): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subFiles = await this.getAllFiles(fullPath, extensions);
          files.push(...subFiles);
        } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Directory might not exist or be readable
    }

    return files;
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
   * Clear file cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }
}
