/**
 * Dependency graph builder for code review context
 * Analyzes import relationships and builds dependency trees
 */

import { promises as fs } from "fs";
import path from "path";
import { logger } from "../../utils/logger";
import { MossClient } from "../indexer/moss-client.js";

export interface DependencyNode {
  filePath: string;
  imports: string[]; // Resolved file paths
  exports: string[]; // Export names
  depth: number;
  relationship: "upstream" | "downstream" | "self";
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
  private repoName: string;
  private mossClient: MossClient;
  private fileCache: Map<string, string> = new Map();

  constructor(repoPath: string, repoName: string, mossClient: MossClient) {
    this.repoPath = repoPath;
    this.repoName = repoName;
    this.mossClient = mossClient;
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
    const {
      maxDepth = 2,
      includeTests = true,
      includeNodeModules = false,
    } = options;
    logger.debug(
      `[DependencyGraph] Building graph for ${filePath} (maxDepth=${maxDepth})`
    );
    const startTime = Date.now();

    try {
      // Get upstream dependencies (what this file imports)
      logger.debug(`[DependencyGraph] Finding upstream dependencies...`);
      const upstream = await this.getUpstreamDependencies(
        filePath,
        maxDepth,
        includeNodeModules
      );
      logger.debug(
        `[DependencyGraph] Found ${upstream.length} upstream dependencies`
      );

      // Log upstream dependencies for verification
      if (upstream.length > 0) {
        logger.info(
          `[DependencyGraph] ===== UPSTREAM DEPENDENCIES FOR ${filePath} =====`
        );
        upstream.forEach((dep, index) => {
          logger.info(
            `[DependencyGraph]   [${index + 1}] ${dep.filePath} (depth: ${
              dep.depth
            })`
          );
          logger.info(
            `[DependencyGraph]       imports: [${dep.imports.join(", ")}]`
          );
        });
        logger.info(`[DependencyGraph] ===== END UPSTREAM DEPENDENCIES =====`);
      } else {
        logger.info(
          `[DependencyGraph] No upstream dependencies found for ${filePath}`
        );
      }

      // Get downstream dependencies (what imports this file)
      logger.debug(`[DependencyGraph] Finding downstream dependencies...`);
      const downstream = await this.getDownstreamDependencies(
        filePath,
        maxDepth
      );
      logger.debug(
        `[DependencyGraph] Found ${downstream.length} downstream dependencies`
      );

      // Log downstream dependencies for verification
      if (downstream.length > 0) {
        logger.info(
          `[DependencyGraph] DOWNSTREAM DEPENDENCIES FOR ${filePath}`
        );
        downstream.forEach((dep, index) => {
          logger.info(
            `[DependencyGraph]   [${index + 1}] ${dep.filePath} (depth: ${
              dep.depth
            })`
          );
          logger.info(
            `[DependencyGraph]       imports from target: ${dep.imports[0]}`
          );
        });
      } else {
        logger.info(
          `[DependencyGraph] No downstream dependencies found for ${filePath}`
        );
      }

      // Find related tests
      const tests = includeTests ? await this.findRelatedTests(filePath) : [];
      logger.debug(
        `[DependencyGraph] Found ${tests.length} related test files`
      );

      const duration = Date.now() - startTime;
      logger.debug(
        `[DependencyGraph] Graph built in ${duration}ms: ` +
          `${upstream.length} upstream, ${downstream.length} downstream, ${tests.length} tests`
      );

      return { upstream, downstream, tests };
    } catch (error) {
      logger.error(
        `[DependencyGraph] Error building dependency graph for ${filePath}:`,
        error
      );
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
        const resolvedImports = await this.resolveImports(
          imports,
          currentPath,
          includeNodeModules
        );

        if (depth > 0) {
          dependencies.push({
            filePath: currentPath,
            imports: resolvedImports.map((imp) => imp.resolvedPath),
            exports: this.extractExports(content),
            depth,
            relationship: "upstream",
          });
        }

        // Recursively traverse imports (only if we haven't reached max depth)
        if (depth < maxDepth) {
          for (const imp of resolvedImports) {
            await traverse(imp.resolvedPath, depth + 1);
          }
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
        const files = await this.getAllFiles(dir, [
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
        ]);

        for (const file of files) {
          if (file === filePath) continue;

          try {
            const content = await this.readFile(file);
            const imports = this.extractImports(content, file);

            // Resolve all imports in parallel and check if any match our target
            const resolvedImports = await this.resolveImports(
              imports,
              file,
              false
            );

            const importsTargetFile = resolvedImports.some(
              (resolved) =>
                path.normalize(resolved.resolvedPath) ===
                path.normalize(filePath)
            );

            if (importsTargetFile) {
              dependencies.push({
                filePath: file,
                imports: [filePath],
                exports: this.extractExports(content),
                depth: 1,
                relationship: "downstream",
              });
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
    logger.debug(
      `[DependencyGraph] Searching for tests related to ${filePath}`
    );
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
    const testsDir = path.join(fileDir, "__tests__");
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
      const names = match[1]
        .split(",")
        .map((n) => n.trim().split(/\s+as\s+/)[0]);
      exports.push(...names);
    }

    // Export declarations: export const foo = ...
    const declPattern =
      /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    while ((match = declPattern.exec(content)) !== null) {
      exports.push(match[1]);
    }

    // Default export
    if (/export\s+default/.test(content)) {
      exports.push("default");
    }

    return [...new Set(exports)];
  }

  /**
   * Extract base path from import for Moss lookup
   * Examples:
   *   "@/services/wallet.service" → "services/wallet.service"
   *   "./utils/helper" → "utils/helper" (relative from current dir)
   *   "../../core/types" → "core/types" (resolved relative path)
   */
  private extractBasePathFromImport(
    importPath: string,
    fromFile: string
  ): string {
    // Remove leading @ and slash for path aliases
    if (importPath.startsWith("@/")) {
      return importPath.substring(2);
    }

    // For relative imports, resolve them relative to the importing file
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      const fromDir = path.dirname(fromFile);
      const resolvedPath = path.resolve(fromDir, importPath);
      return path.relative(this.repoPath, resolvedPath);
    }

    // Absolute or package imports - return as-is
    return importPath;
  }

  /**
   * Resolve import paths to actual file paths using Moss
   */
  private async resolveImports(
    imports: string[],
    fromFile: string,
    includeNodeModules: boolean
  ): Promise<Array<{ importPath: string; resolvedPath: string }>> {
    // Filter imports based on includeNodeModules
    const localImports = imports.filter((imp) => {
      if (!includeNodeModules) {
        // Only include local imports
        return (
          imp.startsWith("@") || imp.startsWith(".") || imp.startsWith("/")
        );
      }
      return true;
    });

    logger.info(
      `[DependencyGraph] ===== MOSS IMPORT RESOLUTION FOR: ${fromFile} =====`
    );
    logger.info(
      `[DependencyGraph] Total imports to resolve: ${localImports.length}`
    );

    // Resolve ALL imports in parallel using Promise.all
    const resolvePromises = localImports.map(async (imp, index) => {
      const basePath = this.extractBasePathFromImport(imp, fromFile);
      const extensions = [".ts", ".tsx", ".js", ".jsx"];

      logger.info(
        `[DependencyGraph] [${index + 1}/${localImports.length}] Resolving import: "${imp}"`
      );
      logger.info(`[DependencyGraph]   → Extracted basePath: "${basePath}"`);
      logger.info(
        `[DependencyGraph]   → Calling Moss.findIndexedFile(repo="${this.repoName}", basePath="${basePath}", extensions=${JSON.stringify(extensions)})`
      );

      const resolvedPath = await this.mossClient.findIndexedFile(
        this.repoName,
        basePath,
        extensions
      );

      logger.info(
        `[DependencyGraph]   → Moss returned: ${resolvedPath ? `"${resolvedPath}"` : "null"}`
      );

      if (resolvedPath) {
        // Convert relative path to absolute
        const absolutePath = path.resolve(this.repoPath, resolvedPath);
        logger.info(
          `[DependencyGraph]   ✓ SUCCESS: "${imp}" → "${absolutePath}"`
        );
        return { importPath: imp, resolvedPath: absolutePath };
      }

      logger.info(`[DependencyGraph]   ✗ FAILED: Could not resolve "${imp}"`);
      return null;
    });

    const results = await Promise.all(resolvePromises);
    const resolved = results.filter(
      (r): r is { importPath: string; resolvedPath: string } => r !== null
    );

    logger.info(
      `[DependencyGraph] ===== MOSS RESOLUTION SUMMARY =====`
    );
    logger.info(
      `[DependencyGraph] Total: ${localImports.length} | Resolved: ${resolved.length} | Failed: ${localImports.length - resolved.length}`
    );
    logger.info(`[DependencyGraph] ===== END MOSS RESOLUTION =====`);

    return resolved;
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
  private async getAllFiles(
    dir: string,
    extensions: string[]
  ): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          const subFiles = await this.getAllFiles(fullPath, extensions);
          files.push(...subFiles);
        } else if (
          entry.isFile() &&
          extensions.some((ext) => entry.name.endsWith(ext))
        ) {
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

    const content = await fs.readFile(filePath, "utf-8");
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
