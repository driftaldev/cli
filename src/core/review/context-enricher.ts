/**
 * Context Enricher - Main engine for gathering comprehensive code context
 * Combines static analysis, semantic search, and dependency graphs
 */

import { promises as fs } from "fs";
import path from "path";
import {
  DependencyGraphBuilder,
  DependencyNode,
  TestFile,
} from "./dependency-graph.js";
import { EnrichedContext } from "./context-strategies.js";
import { logger } from "../../utils/logger.js";
import { MossClient } from "../indexer/moss-client.js";
import { execSync } from "child_process";
import {
  getLanguageParser,
  Import as ParserImport,
  TypeDefinition as ParserType,
} from "../parsers/language-parser.js";

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
    const { loadConfig } = await import("../../config/loader.js");
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
      logger.debug(
        `[ContextEnricher] File read complete (${fullContent.length} chars)`
      );

      // Initialize dependency graph builder with MossClient
      const depGraphBuilder = await this.getDepGraphBuilder();

      // Run all enrichment steps in parallel for speed
      logger.debug(`[ContextEnricher] Starting parallel enrichment steps`);
      const [imports, types, similarPatterns, depGraph] = await Promise.all([
        this.extractImports(fullContent, input.fullFilePath, input.language),
        this.extractTypes(fullContent, input.fullFilePath, input.language),
        this.findSimilarPatterns(
          input.changedCode,
          input.language,
          input.fileName
        ),
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
            content: dep.content, // Full file content for depth 1 dependencies
            relevantDefinitions: dep.relevantDefinitions, // Extracted signatures
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
   * Now uses Moss resolution through DependencyGraphBuilder for consistency
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
      logger.debug(
        `[ContextEnricher] Found ${importStatements.length} import statements`
      );

      // Get dependency graph builder (which has Moss with our fixes)
      const depGraphBuilder = await this.getDepGraphBuilder();

      for (const stmt of importStatements) {
        // Resolve import path using Moss (through DependencyGraphBuilder)
        logger.debug(`[ContextEnricher] Resolving import: ${stmt.path}`);
        const resolvedPath = await depGraphBuilder.resolveImport(
          stmt.path,
          filePath
        );

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
          logger.debug(
            `[ContextEnricher] Could not resolve import: ${stmt.path} (likely external package)`
          );
        }
      }

      logger.debug(
        `[ContextEnricher] Successfully extracted ${imports.length} imports`
      );
    } catch (error) {
      logger.warn(
        `[ContextEnricher] Error extracting imports from ${filePath}:`,
        error
      );
    }

    return imports;
  }

  /**
   * Parse import statements from code using language-specific parsers
   */
  private parseImportStatements(
    content: string,
    language: string
  ): Array<{ path: string; names: string[] }> {
    logger.debug(
      `[ContextEnricher] Parsing imports using language parser for ${language}`
    );

    try {
      // Use language-specific parser
      const parser = getLanguageParser(content, language);
      const imports = parser.parseImports();

      logger.debug(
        `[ContextEnricher] Language parser extracted ${imports.length} imports`
      );

      // Convert to expected format
      const statements = imports.map((imp) => {
        // Get imported names from items, or use alias for namespace imports
        let names: string[] = [];

        if (imp.items.length > 0) {
          // Named imports
          names = imp.items.map((item) => item.alias || item.name);
        } else if (imp.alias && imp.alias !== "*") {
          // Namespace import (import * as foo)
          names = [imp.alias];
        } else if (imp.alias === "*") {
          // Glob import
          names = ["*"];
        }

        return {
          path: imp.source,
          names,
        };
      });

      logger.debug(
        `[ContextEnricher] Converted to ${statements.length} import statements`
      );
      return statements;
    } catch (error) {
      logger.warn(
        `[ContextEnricher] Error parsing imports with language parser:`,
        error
      );
      // Fallback to empty array instead of crashing
      return [];
    }
  }

  /**
   * Resolve import path using language-aware resolution
   */
  private async resolveImportPath(
    importPath: string,
    fromFile: string
  ): Promise<string | null> {
    logger.debug(
      `[ContextEnricher] resolveImportPath called for: "${importPath}" from ${fromFile}`
    );

    // Detect language from file extension
    const fileExt = path.extname(fromFile);
    let language = "unknown";
    if ([".ts", ".tsx", ".js", ".jsx"].includes(fileExt)) {
      language = "typescript";
    } else if (fileExt === ".py") {
      language = "python";
    } else if (fileExt === ".go") {
      language = "go";
    } else if (fileExt === ".rs") {
      language = "rust";
    }

    logger.debug(`[ContextEnricher] Detected language: ${language}`);

    // Language-specific resolution
    switch (language) {
      case "typescript":
        return this.resolveTypescriptImport(importPath, fromFile);
      case "python":
        return this.resolvePythonImport(importPath, fromFile);
      case "go":
        return this.resolveGoImport(importPath, fromFile);
      case "rust":
        return this.resolveRustImport(importPath, fromFile);
      default:
        logger.debug(`[ContextEnricher] Unknown language, skipping resolution`);
        return null;
    }
  }

  /**
   * Resolve TypeScript/JavaScript imports
   */
  private async resolveTypescriptImport(
    importPath: string,
    fromFile: string
  ): Promise<string | null> {
    // Skip obvious external packages (no @ or . prefix)
    if (
      !importPath.startsWith("@") &&
      !importPath.startsWith(".") &&
      !importPath.startsWith("/")
    ) {
      logger.debug(`[ContextEnricher] "${importPath}" is external package`);
      return null;
    }

    // Extract base filename
    const parts = importPath.split("/");
    const baseFileName = parts[parts.length - 1];

    // File extensions to try
    const extensions = [".ts", ".tsx", ".js", ".jsx"];

    // Try direct file match
    for (const ext of extensions) {
      const searchPattern = `${baseFileName}${ext}`;
      try {
        const cmd = `find "${this.options.repoPath}" -name "${searchPattern}" -type f 2>/dev/null | head -1`;
        const result = execSync(cmd, { encoding: "utf-8" }).trim();

        if (result) {
          logger.debug(
            `[ContextEnricher] ✓ Found "${importPath}" → "${result}"`
          );
          return result;
        }
      } catch (error) {
        // Continue to next extension
      }
    }

    // Try index files
    for (const ext of extensions) {
      try {
        const cmd = `find "${this.options.repoPath}" -path "*/${baseFileName}/index${ext}" -type f 2>/dev/null | head -1`;
        const result = execSync(cmd, { encoding: "utf-8" }).trim();

        if (result) {
          logger.debug(
            `[ContextEnricher] ✓ Found index file for "${importPath}" → "${result}"`
          );
          return result;
        }
      } catch (error) {
        // Continue
      }
    }

    logger.debug(`[ContextEnricher] ✗ Could not resolve "${importPath}"`);
    return null;
  }

  /**
   * Resolve Python imports
   */
  private async resolvePythonImport(
    importPath: string,
    fromFile: string
  ): Promise<string | null> {
    // Convert module path to file path
    // e.g., "foo.bar.baz" → "foo/bar/baz.py" or "foo/bar/baz/__init__.py"
    const modulePath = importPath.replace(/\./g, "/");

    // Try direct .py file
    try {
      const cmd = `find "${this.options.repoPath}" -path "*/${modulePath}.py" -type f 2>/dev/null | head -1`;
      const result = execSync(cmd, { encoding: "utf-8" }).trim();

      if (result) {
        logger.debug(
          `[ContextEnricher] ✓ Found Python module "${importPath}" → "${result}"`
        );
        return result;
      }
    } catch (error) {
      // Continue
    }

    // Try __init__.py in directory
    try {
      const cmd = `find "${this.options.repoPath}" -path "*/${modulePath}/__init__.py" -type f 2>/dev/null | head -1`;
      const result = execSync(cmd, { encoding: "utf-8" }).trim();

      if (result) {
        logger.debug(
          `[ContextEnricher] ✓ Found Python package "${importPath}" → "${result}"`
        );
        return result;
      }
    } catch (error) {
      // Continue
    }

    // Try relative imports (same directory)
    if (importPath.startsWith(".")) {
      const fromDir = path.dirname(fromFile);
      const relativePath = path.join(fromDir, modulePath + ".py");

      if (await this.fileExists(relativePath)) {
        logger.debug(
          `[ContextEnricher] ✓ Found relative Python import "${importPath}" → "${relativePath}"`
        );
        return relativePath;
      }
    }

    logger.debug(
      `[ContextEnricher] ✗ Could not resolve Python import "${importPath}"`
    );
    return null;
  }

  /**
   * Resolve Go imports
   */
  private async resolveGoImport(
    importPath: string,
    fromFile: string
  ): Promise<string | null> {
    // For relative imports (./foo or ../foo), resolve directly
    if (importPath.startsWith(".")) {
      const fromDir = path.dirname(fromFile);
      const resolvedDir = path.resolve(fromDir, importPath);

      // Check for .go files in that directory
      try {
        const cmd = `find "${resolvedDir}" -maxdepth 1 -name "*.go" -type f 2>/dev/null | head -1`;
        const result = execSync(cmd, { encoding: "utf-8" }).trim();

        if (result) {
          logger.debug(
            `[ContextEnricher] ✓ Found Go package "${importPath}" → "${result}"`
          );
          return result;
        }
      } catch (error) {
        // Continue
      }
    }

    // For absolute imports, extract the last part of the path
    // e.g., "github.com/user/repo/pkg/utils" → search for "utils" directory with .go files
    const parts = importPath.split("/");
    const packageName = parts[parts.length - 1];

    try {
      const cmd = `find "${this.options.repoPath}" -type d -name "${packageName}" 2>/dev/null | while read dir; do find "$dir" -maxdepth 1 -name "*.go" -type f 2>/dev/null | head -1; done | head -1`;
      const result = execSync(cmd, { encoding: "utf-8" }).trim();

      if (result) {
        logger.debug(
          `[ContextEnricher] ✓ Found Go package "${importPath}" → "${result}"`
        );
        return result;
      }
    } catch (error) {
      // Continue
    }

    logger.debug(
      `[ContextEnricher] ✗ Could not resolve Go import "${importPath}"`
    );
    return null;
  }

  /**
   * Resolve Rust imports
   */
  private async resolveRustImport(
    importPath: string,
    fromFile: string
  ): Promise<string | null> {
    // Handle crate imports
    if (importPath.startsWith("crate::")) {
      // Find src/lib.rs or src/main.rs as starting point
      const srcPath = path.join(this.options.repoPath, "src");
      const modulePath = importPath.replace("crate::", "").replace(/::/g, "/");

      // Try module file
      const moduleFile = path.join(srcPath, modulePath + ".rs");
      if (await this.fileExists(moduleFile)) {
        logger.debug(
          `[ContextEnricher] ✓ Found Rust module "${importPath}" → "${moduleFile}"`
        );
        return moduleFile;
      }

      // Try mod.rs in directory
      const modFile = path.join(srcPath, modulePath, "mod.rs");
      if (await this.fileExists(modFile)) {
        logger.debug(
          `[ContextEnricher] ✓ Found Rust module "${importPath}" → "${modFile}"`
        );
        return modFile;
      }
    }

    // Handle super/self imports
    if (importPath.startsWith("super::") || importPath.startsWith("self::")) {
      const fromDir = path.dirname(fromFile);
      const relativePath = importPath
        .replace("super::", "../")
        .replace("self::", "./")
        .replace(/::/g, "/");
      const resolvedPath = path.resolve(fromDir, relativePath + ".rs");

      if (await this.fileExists(resolvedPath)) {
        logger.debug(
          `[ContextEnricher] ✓ Found Rust module "${importPath}" → "${resolvedPath}"`
        );
        return resolvedPath;
      }
    }

    logger.debug(
      `[ContextEnricher] ✗ Could not resolve Rust import "${importPath}"`
    );
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
        new RegExp(
          `(?:export\\s+)?function\\s+${name}\\s*\\([^)]*\\)[^{]*{[\\s\\S]{0,500}`,
          "m"
        ),
        // Class: export class Foo or class Foo
        new RegExp(
          `(?:export\\s+)?class\\s+${name}\\s+(?:extends\\s+\\w+\\s+)?{[\\s\\S]{0,500}`,
          "m"
        ),
        // Interface: export interface Foo
        new RegExp(
          `(?:export\\s+)?interface\\s+${name}\\s+{[\\s\\S]{0,500}`,
          "m"
        ),
        // Type: export type Foo =
        new RegExp(`(?:export\\s+)?type\\s+${name}\\s*=[\\s\\S]{0,300}`, "m"),
        // Const: export const foo =
        new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=[\\s\\S]{0,300}`, "m"),
        // Enum: export enum Foo
        new RegExp(`(?:export\\s+)?enum\\s+${name}\\s+{[\\s\\S]{0,300}`, "m"),
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
      ? definitions.join("\n\n")
      : `// Definitions for: ${importedNames.join(", ")}`;
  }

  /**
   * Extract type definitions from file using language-specific parsers
   */
  private async extractTypes(
    content: string,
    filePath: string,
    language: string
  ): Promise<TypeInfo[]> {
    logger.debug(
      `[ContextEnricher] Extracting types from ${filePath} (${language})`
    );

    try {
      // Use language-specific parser
      const parser = getLanguageParser(content, language);
      const parsedTypes = parser.parseTypes();

      logger.debug(
        `[ContextEnricher] Language parser extracted ${parsedTypes.length} types`
      );

      // Convert to expected format
      const types: TypeInfo[] = parsedTypes.map((type) => {
        // Reconstruct a definition string (for display purposes)
        let definition = this.formatTypeDefinition(type);

        return {
          name: type.name,
          definition,
          source: filePath,
        };
      });

      // Count by type for logging
      const counts = parsedTypes.reduce(
        (acc, type) => {
          acc[type.type] = (acc[type.type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      logger.debug(
        `[ContextEnricher] Extracted ${types.length} types: ` +
          Object.entries(counts)
            .map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
            .join(", ")
      );

      return types;
    } catch (error) {
      logger.warn(
        `[ContextEnricher] Error extracting types with language parser:`,
        error
      );
      return [];
    }
  }

  /**
   * Format a type definition for display
   */
  private formatTypeDefinition(type: ParserType): string {
    const parts: string[] = [];

    // Type declaration
    if (type.type === "interface") {
      parts.push(`interface ${type.name}`);
      if (type.generics) {
        parts.push(`<${type.generics.join(", ")}>`);
      }
      if (type.extends && type.extends.length > 0) {
        parts.push(` extends ${type.extends.join(", ")}`);
      }
    } else if (type.type === "class") {
      parts.push(`class ${type.name}`);
      if (type.generics) {
        parts.push(`<${type.generics.join(", ")}>`);
      }
      if (type.extends && type.extends.length > 0) {
        parts.push(` extends ${type.extends.join(", ")}`);
      }
      if (type.implements && type.implements.length > 0) {
        parts.push(` implements ${type.implements.join(", ")}`);
      }
    } else if (type.type === "struct") {
      parts.push(`struct ${type.name}`);
      if (type.generics) {
        parts.push(`<${type.generics.join(", ")}>`);
      }
    } else if (type.type === "trait") {
      parts.push(`trait ${type.name}`);
      if (type.generics) {
        parts.push(`<${type.generics.join(", ")}>`);
      }
    } else if (type.type === "enum") {
      parts.push(`enum ${type.name}`);
    } else {
      parts.push(`type ${type.name}`);
    }

    // Add properties if available
    if (type.properties && type.properties.length > 0) {
      parts.push(" { ");
      const propLines = type.properties.slice(0, 10).map((prop) => {
        return `${prop.name}${prop.optional ? "?" : ""}: ${prop.type || "any"}`;
      });
      parts.push(propLines.join(", "));
      if (type.properties.length > 10) {
        parts.push(`, ... (${type.properties.length - 10} more)`);
      }
      parts.push(" }");
    }

    // Add methods if available (for interfaces/traits)
    if (type.methods && type.methods.length > 0 && !type.properties) {
      parts.push(" { ");
      const methodLines = type.methods.slice(0, 5).map((method) => {
        const params = method.parameters
          .map((p) => `${p.name}: ${p.type || "any"}`)
          .join(", ");
        return `${method.name}(${params})${method.returnType ? `: ${method.returnType}` : ""}`;
      });
      parts.push(methodLines.join("; "));
      if (type.methods.length > 5) {
        parts.push(`; ... (${type.methods.length - 5} more)`);
      }
      parts.push(" }");
    }

    return parts.join("");
  }

  /**
   * Find similar code patterns using Moss semantic search
   */
  private async findSimilarPatterns(
    code: string,
    language: string,
    currentFile: string
  ): Promise<Array<{ filePath: string; code: string; similarity: number }>> {
    logger.debug(
      `[ContextEnricher] Finding similar patterns for ${currentFile}`
    );

    try {
      // Extract a meaningful query from the changed code
      const query = this.extractSemanticQuery(code);

      if (!query) {
        logger.debug(
          `[ContextEnricher] No meaningful query extracted from code`
        );
        return [];
      }

      logger.debug(
        `[ContextEnricher] Searching Moss with query: "${query.substring(0, 50)}..."`
      );

      // Search Moss index
      const mossClient = await this.getMossClient();
      const searchResults = await mossClient.search({
        query,
        repos: [this.options.repoName],
        max_results: this.options.maxSimilarPatterns * 2, // Get more, filter later
        file_types: this.getFileExtensions(language),
      });

      logger.debug(
        `[ContextEnricher] Moss returned ${searchResults.results.length} results`
      );

      // Convert results to similar patterns
      const patterns = searchResults.results
        .filter((result) => {
          // Exclude the current file
          return !result.file_path?.includes(currentFile);
        })
        .map((result) => ({
          filePath: result.file_path || "",
          code: result.content || "",
          similarity: result.score || 0,
        }))
        .slice(0, this.options.maxSimilarPatterns);

      logger.debug(
        `[ContextEnricher] Found ${patterns.length} similar patterns after filtering`
      );

      return patterns;
    } catch (error) {
      // Silently fail if index doesn't exist or search fails
      // This is expected when the repo hasn't been indexed yet
      logger.debug(
        "[ContextEnricher] Moss search failed (repo may not be indexed):",
        error
      );
      return [];
    }
  }

  /**
   * Extract semantic query from code
   */
  private extractSemanticQuery(code: string): string {
    // Remove comments
    let query = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

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
    const lines = query.split("\n").filter((l) => l.trim().length > 10);
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
      typescript: ["ts", "tsx"],
      javascript: ["js", "jsx"],
      python: ["py"],
      rust: ["rs"],
      go: ["go"],
      java: ["java"],
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
   * Clear caches
   */
  clearCache(): void {
    this.fileCache.clear();
    if (this.depGraphBuilder) {
      this.depGraphBuilder.clearCache();
    }
  }
}
