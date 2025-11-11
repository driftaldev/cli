import inquirer from "inquirer";
import inquirerSearchList from "inquirer-search-list";
import fs from "fs/promises";
import path from "path";
import ignore from "ignore";
import { getGitRoot } from "./git.js";

// Register the search-list prompt for real-time fuzzy search
inquirer.registerPrompt("search-list", inquirerSearchList);

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
    ".driftal/**"
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
 * Fuzzy search function for filtering files
 * Supports VSCode-like fuzzy matching (e.g., "rvcmd" matches "review-cmd.ts")
 */
function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;

  query = query.toLowerCase();
  target = target.toLowerCase();

  // Direct substring match (highest priority)
  if (target.includes(query)) return true;

  // Fuzzy match: all characters in query must appear in order in target
  let queryIndex = 0;
  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (target[i] === query[queryIndex]) {
      queryIndex++;
    }
  }

  return queryIndex === query.length;
}

/**
 * Calculate fuzzy match score for sorting results
 * Higher score = better match
 */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;

  query = query.toLowerCase();
  target = target.toLowerCase();

  // Exact match gets highest score
  if (target === query) return 1000;

  // Starts with query gets high score
  if (target.startsWith(query)) return 900;

  // Contains query as substring gets good score
  const index = target.indexOf(query);
  if (index !== -1) return 800 - index;

  // Fuzzy match gets lower score based on character positions
  let score = 0;
  let queryIndex = 0;
  let lastMatchIndex = -1;

  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (target[i] === query[queryIndex]) {
      // Reward consecutive matches
      if (lastMatchIndex === i - 1) {
        score += 10;
      } else {
        score += 1;
      }
      lastMatchIndex = i;
      queryIndex++;
    }
  }

  return queryIndex === query.length ? score : 0;
}

/**
 * Filter and sort files based on fuzzy search query
 */
function fuzzyFilter(files: string[], query: string = ""): string[] {
  if (!query) return files;

  const matches = files
    .filter(file => fuzzyMatch(query, file))
    .map(file => ({
      file,
      score: fuzzyScore(query, file)
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.file);

  return matches;
}

/**
 * Show an interactive file selector with real-time fuzzy search
 * Supports @ prefix for selecting files
 */
export async function selectFiles(
  repoPath: string,
  message: string = "Select files to review"
): Promise<string[]> {
  // Get all files in the repository
  const allFiles = await getAllFiles(repoPath);

  if (allFiles.length === 0) {
    throw new Error("No files found in the repository");
  }

  console.log(`\n📁 Found ${allFiles.length} files in repository`);
  console.log("💡 Type to search in real-time (e.g., 'rvcmd' matches 'src/cli/review-cmd.ts')\n");

  const selectedFiles: string[] = [];
  let continueSelecting = true;

  while (continueSelecting) {
    const remainingFiles = allFiles.filter(file => !selectedFiles.includes(file));

    if (remainingFiles.length === 0) {
      console.log("\n✓ All files selected!");
      break;
    }

    // Show real-time search list with fuzzy filtering
    const answer = await inquirer.prompt([
      {
        type: "search-list",
        name: "file",
        message: selectedFiles.length > 0
          ? `${message} (${selectedFiles.length} selected, type to search or "done" to finish)`
          : `${message} (type to search)`,
        choices: [
          ...(selectedFiles.length > 0 ? [
            { name: "✓ Done (finish selection)", value: "__done__" },
            new inquirer.Separator("─────────────────────────────")
          ] : []),
          ...remainingFiles.map(file => ({ name: file, value: file }))
        ]
      }
    ]);

    if (answer.file === "__done__") {
      continueSelecting = false;
    } else if (answer.file) {
      selectedFiles.push(answer.file);
      console.log(`  ✓ Added: ${answer.file}`);

      // Ask if user wants to continue
      const continueAnswer = await inquirer.prompt([
        {
          type: "confirm",
          name: "continue",
          message: "Select another file?",
          default: true
        }
      ]);

      continueSelecting = continueAnswer.continue;
    }
  }

  if (selectedFiles.length === 0) {
    throw new Error("No files selected");
  }

  console.log(`\n✓ Selected ${selectedFiles.length} file(s):\n`);
  selectedFiles.forEach(file => console.log(`  - ${file}`));
  console.log("");

  return selectedFiles;
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
