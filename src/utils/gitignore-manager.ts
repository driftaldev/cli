import fs from "fs/promises";
import path from "path";
import { logger } from "./logger.js";

/**
 * Ensures that .driftal is added to the project's .gitignore file.
 * This prevents the .driftal folder from being committed to git.
 *
 * @param repoRoot - The root directory of the repository
 */
export async function ensureDriftalInGitignore(repoRoot: string): Promise<void> {
  const gitignorePath = path.join(repoRoot, ".gitignore");

  try {
    // Check if .gitignore exists
    let gitignoreContent = "";
    let gitignoreExists = false;

    try {
      gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
      gitignoreExists = true;
    } catch (error: unknown) {
      // .gitignore doesn't exist, we'll create it
      if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
        // Some other error occurred (permission issues, etc.)
        logger.error(`Error reading .gitignore: ${String(error)}`);
        return;
      }
    }

    // Check if .driftal is already in .gitignore
    // Match patterns like: .driftal, .driftal/, /.driftal, etc.
    const driftalPatterns = [
      /^\.driftal\s*$/m,
      /^\.driftal\/\s*$/m,
      /^\/\.driftal\s*$/m,
      /^\/\.driftal\/\s*$/m,
      /^\*\*\/\.driftal\/?\*\*\s*$/m
    ];

    const hasDriftal = driftalPatterns.some(pattern => pattern.test(gitignoreContent));

    if (hasDriftal) {
      logger.debug(".driftal already exists in .gitignore");
      return;
    }

    // Add .driftal to .gitignore
    const newContent = gitignoreExists
      ? `${gitignoreContent.trimEnd()}\n\n# Driftal CLI metadata and indexes\n.driftal\n`
      : `# Driftal CLI metadata and indexes\n.driftal\n`;

    await fs.writeFile(gitignorePath, newContent, "utf-8");

    if (gitignoreExists) {
      logger.info("Added .driftal to .gitignore");
    } else {
      logger.info("Created .gitignore with .driftal entry");
    }
  } catch (error) {
    // Log the error but don't fail the operation
    logger.error(`Failed to update .gitignore: ${String(error)}`);
  }
}
