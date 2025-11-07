import fs from 'fs/promises';
import path from 'path';

export async function readFileContent(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolvePath(baseDir: string, relativePath: string): string {
  return path.resolve(baseDir, relativePath);
}
