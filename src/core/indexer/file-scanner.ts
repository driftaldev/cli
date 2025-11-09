import { Buffer } from "buffer";
import fs from "fs/promises";
import path from "path";

import ignore from "ignore";
import { shouldIgnoreFile, shouldIgnoreDirectory, MAX_FILE_SIZE } from "./ignore-patterns";
import type { Stack } from "./stack-detector";
import { logger } from "../../utils/logger.js";

export interface IndexFilePayload {
  path: string;
  content_base64?: string;
  content?: string;
}

export interface ScanOptions {
  root: string;
  extensions: string[];
  excludePatterns: string[];
  base64Encode?: boolean;
  stacks?: Stack[];
  stackIgnorePatterns?: string[];
}

export async function scanFiles(
  options: ScanOptions
): Promise<IndexFilePayload[]> {
  const { root, extensions, excludePatterns, base64Encode = false, stackIgnorePatterns = [] } = options;
  const ig = ignore().add(excludePatterns);
  const files: IndexFilePayload[] = [];

  async function walk(dir: string, prefix = ""): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relPath = path.join(prefix, entry.name);

      // Check gitignore-style patterns first
      if (ig.ignores(relPath)) {
        continue;
      }

      // Check stack-specific ignore patterns
      if (stackIgnorePatterns.length > 0 && shouldIgnoreFile(relPath, stackIgnorePatterns)) {
        continue;
      }

      const fullPath = path.join(root, relPath);

      if (entry.isDirectory()) {
        // Early pruning: skip entire directories if they match ignore patterns
        if (stackIgnorePatterns.length > 0 && shouldIgnoreDirectory(entry.name, stackIgnorePatterns)) {
          continue;
        }
        await walk(fullPath, relPath);
      } else {
        const ext = path.extname(entry.name);
        if (!extensions.includes(ext)) {
          continue;
        }

        // Check file size before reading
        try {
          const stats = await fs.stat(fullPath);
          if (stats.size > MAX_FILE_SIZE) {
            continue; // Skip files larger than threshold
          }
        } catch {
          continue; // Skip if we can't stat the file
        }

        const content = await fs.readFile(fullPath, "utf8");

        logger.debug(`Indexing file: ${relPath}`);

        if (base64Encode) {
          files.push({
            path: relPath,
            content_base64: Buffer.from(content, "utf8").toString("base64")
          });
        } else {
          files.push({
            path: relPath,
            content
          });
        }
      }
    }
  }

  await walk(root);
  return files;
}
