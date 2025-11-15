/**
 * Dependency graph builder for code review context
 * Analyzes import relationships and builds dependency trees
 */

import { promises as fs } from "fs";
import path from "path";
import { logger } from "../../utils/logger";
import { MossClient } from "../indexer/moss-client.js";

/**
 * Log import resolution details to debug folder
 */
async function logImportResolutionToFile(
  filePath: string,
  resolutionDetails: {
    totalImports: number;
    resolvedImports: Array<{
      import: string;
      basePath: string;
      resolvedPath: string | null;
      success: boolean;
    }>;
    extensions: string[];
    repoName: string;
  }
): Promise<void> {
  // Only log when DRIFTAL_DEBUG=1 is set
  if (process.env.DRIFTAL_DEBUG !== "1") {
    return;
  }

  try {
    // Get the working directory (where CLI is run from)
    const workingDir = process.cwd();
    const resolutionsDir = path.join(
      workingDir,
      ".driftal",
      "debug",
      "resolutions"
    );

    // Ensure .driftal/debug/resolutions directory exists
    await fs.mkdir(resolutionsDir, { recursive: true });

    // Create filename: <filename>_import_resolutions.txt
    const baseFileName = path.basename(filePath).replace(/\//g, "_");
    const logFileName = `${baseFileName}_import_resolutions.txt`;
    const logFilePath = path.join(resolutionsDir, logFileName);

    // Format the resolution details for logging
    const successfulResolutions = resolutionDetails.resolvedImports.filter(
      (r) => r.success
    );
    const failedResolutions = resolutionDetails.resolvedImports.filter(
      (r) => !r.success
    );

    const logContent = `
================================================================================
IMPORT RESOLUTION LOG FOR FILE: ${filePath}
TIMESTAMP: ${new Date().toISOString()}
================================================================================

REPOSITORY: ${resolutionDetails.repoName}
TOTAL IMPORTS: ${resolutionDetails.totalImports}
RESOLVED: ${successfulResolutions.length}
FAILED: ${failedResolutions.length}
FILE EXTENSIONS USED: ${resolutionDetails.extensions.join(", ")}

================================================================================
SUCCESSFUL RESOLUTIONS (${successfulResolutions.length}):
================================================================================
${
  successfulResolutions.length > 0
    ? successfulResolutions
        .map(
          (r, idx) =>
            `
[${idx + 1}] Import: "${r.import}"
    → Base Path: "${r.basePath}"
    → Resolved To: "${r.resolvedPath}"
    ✓ SUCCESS
`
        )
        .join("\n")
    : "None"
}

================================================================================
FAILED RESOLUTIONS (${failedResolutions.length}):
================================================================================
${
  failedResolutions.length > 0
    ? failedResolutions
        .map(
          (r, idx) =>
            `
[${idx + 1}] Import: "${r.import}"
    → Base Path: "${r.basePath}"
    → Moss returned: null
    ✗ FAILED (likely external package or file not indexed)
`
        )
        .join("\n")
    : "None"
}

================================================================================
DETAILED IMPORT RESOLUTION ATTEMPTS:
================================================================================
${resolutionDetails.resolvedImports
  .map(
    (r, idx) =>
      `
[${idx + 1}/${resolutionDetails.totalImports}] "${r.import}"
  Step 1: Extract base path from import
          → Result: "${r.basePath}"
  
  Step 2: Strip file extensions (if any)
          → Base path after stripping: "${r.basePath}"
  
  Step 3: Call Moss.findIndexedFile()
          → Repository: "${resolutionDetails.repoName}"
          → Base Path: "${r.basePath}"
          → Extensions to try: [${resolutionDetails.extensions.join(", ")}]
  
  Step 4: Moss lookup result
          → ${r.success ? `✓ FOUND: "${r.resolvedPath}"` : "✗ NOT FOUND (returned null)"}
  
  Final Status: ${r.success ? "✅ RESOLVED" : "❌ UNRESOLVED"}
`
  )
  .join("\n" + "=".repeat(80) + "\n")}

================================================================================
SUMMARY:
================================================================================
Success Rate: ${resolutionDetails.totalImports > 0 ? ((successfulResolutions.length / resolutionDetails.totalImports) * 100).toFixed(1) : 0}%
Total Imports Analyzed: ${resolutionDetails.totalImports}
Successfully Resolved: ${successfulResolutions.length}
Failed to Resolve: ${failedResolutions.length}

Note: Failed resolutions are usually external packages (npm, pip, etc.) which are
      expected and don't indicate a problem with the import resolution system.

================================================================================
END OF IMPORT RESOLUTION LOG
================================================================================
`;

    // Write to file
    await fs.writeFile(logFilePath, logContent, "utf-8");
    logger.debug(`[ImportResolution] Log written to: ${logFilePath}`);
  } catch (error) {
    logger.error(`[ImportResolution] Failed to log import resolutions:`, error);
  }
}

export interface DependencyNode {
  filePath: string;
  imports: string[]; // Resolved file paths
  exports: string[]; // Export names
  depth: number;
  relationship: "upstream" | "downstream" | "self";
  content?: string; // Full file content for LLM context
  relevantDefinitions?: string; // Extracted function/class signatures
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
   * Public method to resolve a single import path
   * Used by Context Enricher to resolve imports using Moss
   */
  async resolveImport(
    importPath: string,
    fromFile: string
  ): Promise<string | null> {
    try {
      const basePath = this.extractBasePathFromImport(importPath, fromFile);
      const extensions = this.getExtensionsForFile(fromFile);

      const resolvedPath = await this.mossClient.findIndexedFile(
        this.repoName,
        basePath,
        extensions
      );

      if (resolvedPath) {
        // Convert relative path to absolute
        return path.resolve(this.repoPath, resolvedPath);
      }

      return null;
    } catch (error) {
      logger.debug(
        `[DependencyGraph] Error resolving import "${importPath}":`,
        error
      );
      return null;
    }
  }

  /**
   * Extract function and class signatures from file content
   * Provides lightweight context about what's defined in a dependency
   */
  private extractFunctionSignatures(content: string): string {
    const signatures: string[] = [];

    // Extract function declarations (with types if TypeScript)
    const functionRegex =
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*{/g;
    let match;

    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1];
      const generics = match[2] || "";
      const params = match[3];
      const returnType = match[4]?.trim() || "";
      const isAsync = content
        .substring(Math.max(0, match.index - 10), match.index)
        .includes("async");

      signatures.push(
        `${isAsync ? "async " : ""}function ${name}${generics}(${params})${returnType ? `: ${returnType}` : ""}`
      );
    }

    // Extract arrow function assignments
    const arrowRegex =
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*([^=]+))?\s*=>/g;
    while ((match = arrowRegex.exec(content)) !== null) {
      const name = match[1];
      const isAsync = !!match[2];
      const params = match[3];
      const returnType = match[4]?.trim() || "";

      signatures.push(
        `${isAsync ? "async " : ""}const ${name} = (${params})${returnType ? `: ${returnType}` : ""} =>`
      );
    }

    // Extract class declarations
    const classRegex =
      /(?:export\s+)?class\s+(\w+)(?:<([^>]+)>)?\s*(?:extends\s+(\w+))?\s*(?:implements\s+([\w,\s]+))?\s*{/g;
    while ((match = classRegex.exec(content)) !== null) {
      const name = match[1];
      const generics = match[2] ? `<${match[2]}>` : "";
      const extendsClause = match[3] ? ` extends ${match[3]}` : "";
      const implementsClause = match[4] ? ` implements ${match[4]}` : "";

      signatures.push(
        `class ${name}${generics}${extendsClause}${implementsClause}`
      );
    }

    // Extract interface declarations
    const interfaceRegex =
      /(?:export\s+)?interface\s+(\w+)(?:<([^>]+)>)?\s*(?:extends\s+([\w,\s]+))?\s*{/g;
    while ((match = interfaceRegex.exec(content)) !== null) {
      const name = match[1];
      const generics = match[2] ? `<${match[2]}>` : "";
      const extendsClause = match[3] ? ` extends ${match[3]}` : "";

      signatures.push(`interface ${name}${generics}${extendsClause}`);
    }

    // Extract type aliases
    const typeRegex =
      /(?:export\s+)?type\s+(\w+)(?:<([^>]+)>)?\s*=\s*([^;]+);?/g;
    while ((match = typeRegex.exec(content)) !== null) {
      const name = match[1];
      const generics = match[2] ? `<${match[2]}>` : "";
      const definition = match[3].trim();

      // Truncate long type definitions
      const truncated =
        definition.length > 100
          ? definition.substring(0, 100) + "..."
          : definition;
      signatures.push(`type ${name}${generics} = ${truncated}`);
    }

    return signatures.slice(0, 20).join("\n"); // Limit to top 20 signatures
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
        // Only log import resolution for the root file (depth 0)
        const resolvedImports = await this.resolveImports(
          imports,
          currentPath,
          includeNodeModules,
          depth === 0 // shouldLog: true for root file, false for dependencies
        );

        if (depth > 0) {
          dependencies.push({
            filePath: currentPath,
            imports: resolvedImports.map((imp) => imp.resolvedPath),
            exports: this.extractExports(content),
            depth,
            relationship: "upstream",
            content: content, // Include full content for LLM
            relevantDefinitions: this.extractFunctionSignatures(content), // Include signatures
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
              false,
              false // Don't log for downstream dependency checks
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
   * Strips any existing file extensions to allow Moss to match with actual source file extensions
   *
   * Examples:
   *   TypeScript: "../services/wallet.service.js" → "services/wallet.service" (will match .ts/.tsx)
   *   Python: "foo.bar.baz" → "foo/bar/baz" (module path, not file extension)
   *   Go: "./utils" → "utils" (package import)
   *   Rust: "crate::services::auth" → handled separately
   */
  private extractBasePathFromImport(
    importPath: string,
    fromFile: string
  ): string {
    // Remove leading @ and slash for path aliases
    if (importPath.startsWith("@/")) {
      const basePath = importPath.substring(2);
      // Strip any file extension from path alias imports
      return this.stripSourceFileExtension(basePath);
    }

    // For relative imports, resolve them relative to the importing file
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      const fromDir = path.dirname(fromFile);
      const resolvedPath = path.resolve(fromDir, importPath);
      let relativePath = path.relative(this.repoPath, resolvedPath);

      // Strip file extension to allow Moss to match with any source extension
      // This handles cases like: import { foo } from './bar.js' → matches bar.ts
      relativePath = this.stripSourceFileExtension(relativePath);

      return relativePath;
    }

    // Absolute or package imports - return as-is
    return importPath;
  }

  /**
   * Strip source file extensions from paths
   * Handles: .js, .jsx, .ts, .tsx, .mjs, .cjs, .py, .go, .rs, etc.
   */
  private stripSourceFileExtension(filePath: string): string {
    const ext = path.extname(filePath);
    const sourceExtensions = [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".mjs",
      ".cjs", // JavaScript/TypeScript
      ".py", // Python
      ".go", // Go
      ".rs", // Rust
      ".java",
      ".kt",
      ".swift",
      ".rb",
      ".php", // Other languages
    ];

    if (ext && sourceExtensions.includes(ext)) {
      return filePath.slice(0, -ext.length);
    }

    return filePath;
  }

  /**
   * Get appropriate file extensions based on source file language
   */
  private getExtensionsForFile(filePath: string): string[] {
    const ext = path.extname(filePath);

    // TypeScript/JavaScript files
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      return [".ts", ".tsx", ".js", ".jsx"];
    }

    // Python files
    if (ext === ".py") {
      return [".py"];
    }

    // Go files
    if (ext === ".go") {
      return [".go"];
    }

    // Rust files
    if (ext === ".rs") {
      return [".rs"];
    }

    // Java
    if (ext === ".java") {
      return [".java"];
    }

    // Kotlin
    if (ext === ".kt") {
      return [".kt"];
    }

    // Ruby
    if (ext === ".rb") {
      return [".rb"];
    }

    // PHP
    if (ext === ".php") {
      return [".php"];
    }

    // Swift
    if (ext === ".swift") {
      return [".swift"];
    }

    // Default to JS/TS
    return [".ts", ".tsx", ".js", ".jsx"];
  }

  /**
   * Resolve import paths to actual file paths using Moss
   */
  private async resolveImports(
    imports: string[],
    fromFile: string,
    includeNodeModules: boolean,
    shouldLog: boolean = false
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

    // Get appropriate extensions based on the source file type
    const extensions = this.getExtensionsForFile(fromFile);
    logger.debug(
      `[DependencyGraph] Using extensions: ${extensions.join(", ")} for ${fromFile}`
    );

    // Track resolution details for logging
    const resolutionDetails: Array<{
      import: string;
      basePath: string;
      resolvedPath: string | null;
      success: boolean;
    }> = [];

    // Resolve ALL imports in parallel using Promise.all
    const resolvePromises = localImports.map(async (imp, index) => {
      const basePath = this.extractBasePathFromImport(imp, fromFile);

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

        // Track resolution for logging
        resolutionDetails.push({
          import: imp,
          basePath,
          resolvedPath: absolutePath,
          success: true,
        });

        return { importPath: imp, resolvedPath: absolutePath };
      }

      logger.info(`[DependencyGraph]   ✗ FAILED: Could not resolve "${imp}"`);

      // Track failed resolution for logging
      resolutionDetails.push({
        import: imp,
        basePath,
        resolvedPath: null,
        success: false,
      });

      return null;
    });

    const results = await Promise.all(resolvePromises);
    const resolved = results.filter(
      (r): r is { importPath: string; resolvedPath: string } => r !== null
    );

    logger.info(`[DependencyGraph] ===== MOSS RESOLUTION SUMMARY =====`);
    logger.info(
      `[DependencyGraph] Total: ${localImports.length} | Resolved: ${resolved.length} | Failed: ${localImports.length - resolved.length}`
    );
    logger.info(`[DependencyGraph] ===== END MOSS RESOLUTION =====`);

    // Log detailed import resolution to file (only for root file in debug mode)
    if (shouldLog) {
      await logImportResolutionToFile(fromFile, {
        totalImports: localImports.length,
        resolvedImports: resolutionDetails,
        extensions,
        repoName: this.repoName,
      });
    }

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
