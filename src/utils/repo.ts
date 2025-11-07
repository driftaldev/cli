import path from "path";

export function getRepoFullName(baseDir: string = process.cwd()): string {
  const resolvedPath = path.resolve(baseDir);
  const folderName = path.basename(resolvedPath);
  return folderName || resolvedPath;
}
