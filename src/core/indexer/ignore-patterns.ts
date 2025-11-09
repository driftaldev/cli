import type { Stack } from "./stack-detector";
import path from "path";

// Maximum file size to index (in bytes) - 100KB
export const MAX_FILE_SIZE = 100 * 1024;

/**
 * Patterns for files/folders to ignore during indexing, organized by stack
 */
const IGNORE_PATTERNS: Record<Stack, string[]> = {
  nodejs: [
    "node_modules/",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "dist/",
    "build/",
    ".next/",
    ".nuxt/",
    "out/",
    "coverage/",
    ".cache/",
    "*.min.js",
    "*.bundle.js",
    "*.chunk.js",
    ".turbo/",
    ".vercel/",
    ".netlify/",
  ],
  python: [
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    "*.pyd",
    ".Python",
    "venv/",
    ".venv/",
    "env/",
    ".env/",
    "pip-lock.txt",
    "Pipfile.lock",
    "poetry.lock",
    "*.egg-info/",
    "*.egg",
    ".eggs/",
    ".pytest_cache/",
    ".mypy_cache/",
    ".tox/",
    "htmlcov/",
    ".coverage",
    "*.cover",
  ],
  rust: [
    "target/",
    "Cargo.lock",
    "**/*.rs.bk",
  ],
  go: [
    "vendor/",
    "go.sum",
    "*.exe",
    "*.test",
  ],
  java: [
    "target/",
    "*.class",
    "*.jar",
    "*.war",
    "*.ear",
    ".gradle/",
    "build/",
    ".mvn/",
  ],
  general: [
    ".git/",
    ".svn/",
    ".hg/",
    ".DS_Store",
    "Thumbs.db",
    "*.log",
    "*.swp",
    "*.swo",
    "*~",
    ".idea/",
    ".vscode/",
    "*.map",
    ".env.local",
    ".env.*.local",
  ],
};

/**
 * Get all ignore patterns for the detected stacks
 */
export function getIgnorePatternsForStacks(stacks: Stack[]): string[] {
  const patterns: string[] = [];

  for (const stack of stacks) {
    const stackPatterns = IGNORE_PATTERNS[stack] || [];
    patterns.push(...stackPatterns);
  }

  // Remove duplicates
  return [...new Set(patterns)];
}

/**
 * Check if a file path should be ignored based on patterns
 * @param filePath The file path to check (relative or absolute)
 * @param ignorePatterns Array of patterns to match against
 * @returns true if the file should be ignored
 */
export function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of ignorePatterns) {
    // Directory patterns (end with /)
    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);
      const pathParts = normalizedPath.split("/");
      if (pathParts.includes(dirPattern)) {
        return true;
      }
    }
    // Exact filename match
    else if (!pattern.includes("/") && !pattern.includes("*")) {
      const fileName = path.basename(normalizedPath);
      if (fileName === pattern) {
        return true;
      }
    }
    // Wildcard patterns (e.g., *.pyc)
    else if (pattern.includes("*")) {
      const regexPattern = pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*");
      const regex = new RegExp(`(^|/)${regexPattern}$`);
      if (regex.test(normalizedPath)) {
        return true;
      }
    }
    // Path contains pattern
    else if (normalizedPath.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a directory should be ignored (for early pruning)
 * @param dirName The directory name
 * @param ignorePatterns Array of patterns to match against
 * @returns true if the directory should be skipped
 */
export function shouldIgnoreDirectory(dirName: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);
      if (dirName === dirPattern) {
        return true;
      }
    }
  }
  return false;
}
