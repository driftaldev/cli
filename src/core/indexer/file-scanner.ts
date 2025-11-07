import { Buffer } from "buffer";
import fs from "fs/promises";
import path from "path";

import ignore from "ignore";

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
}

export async function scanFiles(
  options: ScanOptions
): Promise<IndexFilePayload[]> {
  const { root, extensions, excludePatterns, base64Encode = false } = options;
  const ig = ignore().add(excludePatterns);
  const files: IndexFilePayload[] = [];

  async function walk(dir: string, prefix = ""): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relPath = path.join(prefix, entry.name);
      if (ig.ignores(relPath)) {
        continue;
      }

      const fullPath = path.join(root, relPath);

      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else {
        const ext = path.extname(entry.name);
        if (!extensions.includes(ext)) {
          continue;
        }

        const content = await fs.readFile(fullPath, "utf8");

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
