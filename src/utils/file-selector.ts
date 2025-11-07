import inquirer from "inquirer";
import fs from "fs/promises";
import path from "path";
import ignore from "ignore";
import { getGitRoot } from "./git.js";

/**
 * Get all files in a directory recursively, respecting .gitignore
 */
async function getAllFiles(dir: string, basePath: string = dir): Promise<string[]> {
  const files: string[] = [];

  // Load .gitignore if it exists
  const ig = ignore();
  try {
    const gitignorePath = path.join(basePath, ".gitignore");
    const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
    ig.add(gitignoreContent);
  } catch {
    // .gitignore doesn't exist, continue without it
  }

  // Always ignore common patterns
  ig.add([
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    ".next/**",
    "coverage/**",
    ".scout-code/**"
  ]);

  async function scan(currentDir: string) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        // Check if path should be ignored
        if (ig.ignores(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await scan(dir);
  return files.sort();
}

/**
 * Show an interactive file selector with autocomplete
 * Supports @ prefix for selecting files
 */
export async function selectFiles(
  repoPath: string,
  message: string = "Select files to review (type @ to search)"
): Promise<string[]> {
  // Get all files in the repository
  const allFiles = await getAllFiles(repoPath);

  if (allFiles.length === 0) {
    throw new Error("No files found in the repository");
  }

  // Use inquirer checkbox with search/filter capability
  const answers = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selectedFiles",
      message,
      choices: allFiles.map(file => ({
        name: file,
        value: file
      })),
      pageSize: 15,
      loop: false,
      validate: (input: string[]) => {
        if (input.length === 0) {
          return "Please select at least one file";
        }
        return true;
      }
    }
  ]);

  return answers.selectedFiles;
}

/**
 * Parse file paths from command arguments or prompt for selection
 * Handles @ prefix for interactive selection
 */
export async function parseFileSelection(
  args: string[],
  repoPath: string
): Promise<string[] | null> {
  // Check if user wants interactive selection (@ prefix or no args)
  const hasAtPrefix = args.some(arg => arg.startsWith("@"));

  if (hasAtPrefix || args.length === 0) {
    // Show interactive file selector
    return await selectFiles(repoPath);
  }

  // Return null to indicate no specific files (use default behavior)
  return null;
}

/**
 * Show a searchable file selector
 * This is a simpler version that just prompts for file paths
 */
export async function promptForFiles(
  repoPath: string
): Promise<string[]> {
  const allFiles = await getAllFiles(repoPath);

  const answer = await inquirer.prompt([
    {
      type: "input",
      name: "filePattern",
      message: "Enter file path or pattern (e.g., src/**/*.ts):",
      validate: (input: string) => {
        if (!input.trim()) {
          return "Please enter a file path or pattern";
        }
        return true;
      }
    }
  ]);

  const pattern = answer.filePattern;

  // Simple pattern matching (you could use glob here for more advanced patterns)
  const matchedFiles = allFiles.filter(file =>
    file.includes(pattern) || file.match(new RegExp(pattern))
  );

  if (matchedFiles.length === 0) {
    throw new Error(`No files found matching pattern: ${pattern}`);
  }

  return matchedFiles;
}
