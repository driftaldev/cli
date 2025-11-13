import simpleGit, { DiffResult, SimpleGit } from 'simple-git';

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  return git.revparse(['--abbrev-ref', 'HEAD']);
}

export async function getChangedFiles(repoPath: string): Promise<string[]> {
  const git = simpleGit(repoPath);
  const status = await git.status();
  return [...status.staged, ...status.not_added, ...status.modified];
}

export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffChunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  header: string;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  chunks: DiffChunk[];
  language: string;
}

export interface GitDiff {
  files: DiffFile[];
  stats: {
    additions: number;
    deletions: number;
  };
  base: string;
  head: string;
}

/**
 * Get diff between two commits
 */
export async function getDiff(
  repoPath: string,
  base: string,
  head: string = 'HEAD'
): Promise<GitDiff> {
  const git = simpleGit(repoPath);
  const diffOutput = await git.diff([base, head, '--unified=3']);

  return parseDiffOutput(diffOutput, base, head);
}

/**
 * Get unstaged changes
 */
export async function getUnstagedChanges(repoPath: string): Promise<GitDiff> {
  const git = simpleGit(repoPath);
  const diffOutput = await git.diff(['--unified=3']);

  return parseDiffOutput(diffOutput, 'working-tree', 'HEAD');
}

/**
 * Get staged changes
 */
export async function getStagedChanges(repoPath: string): Promise<GitDiff> {
  const git = simpleGit(repoPath);
  const diffOutput = await git.diff(['--staged', '--unified=3']);

  return parseDiffOutput(diffOutput, 'HEAD', 'staged');
}

/**
 * Get diff for a specific commit
 */
export async function getCommitDiff(
  repoPath: string,
  sha: string
): Promise<GitDiff> {
  const git = simpleGit(repoPath);
  const diffOutput = await git.show([sha, '--unified=3', '--format=']);

  return parseDiffOutput(diffOutput, `${sha}^`, sha);
}

/**
 * Get file history
 */
export async function getFileHistory(
  repoPath: string,
  filePath: string,
  limit: number = 10
): Promise<Array<{ sha: string; message: string; date: Date; author: string }>> {
  const git = simpleGit(repoPath);
  const log = await git.log({ file: filePath, maxCount: limit });

  return log.all.map(commit => ({
    sha: commit.hash,
    message: commit.message,
    date: new Date(commit.date),
    author: commit.author_name
  }));
}

/**
 * Check if repository is clean (no uncommitted changes)
 */
export async function isRepoClean(repoPath: string): Promise<boolean> {
  const git = simpleGit(repoPath);
  const status = await git.status();

  return status.isClean();
}

/**
 * Get current commit SHA
 */
export async function getCurrentCommit(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  return git.revparse(['HEAD']);
}

/**
 * Parse git diff output into structured format
 */
function parseDiffOutput(diffOutput: string, base: string, head: string): GitDiff {
  const files: DiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  if (!diffOutput || diffOutput.trim() === '') {
    return {
      files: [],
      stats: { additions: 0, deletions: 0 },
      base,
      head
    };
  }

  // Split by file headers (diff --git)
  const fileBlocks = diffOutput.split(/(?=diff --git)/);

  for (const block of fileBlocks) {
    if (!block.trim()) continue;

    const file = parseFileBlock(block);
    if (file) {
      files.push(file);

      // Count additions and deletions
      for (const chunk of file.chunks) {
        for (const line of chunk.lines) {
          if (line.type === 'added') totalAdditions++;
          if (line.type === 'removed') totalDeletions++;
        }
      }
    }
  }

  return {
    files,
    stats: {
      additions: totalAdditions,
      deletions: totalDeletions
    },
    base,
    head
  };
}

/**
 * Parse a single file block from diff output
 */
function parseFileBlock(block: string): DiffFile | null {
  const lines = block.split('\n');

  // Parse file header
  const diffGitLine = lines.find(l => l.startsWith('diff --git'));
  if (!diffGitLine) return null;

  const pathMatch = diffGitLine.match(/diff --git a\/(.*?) b\/(.*)/);
  if (!pathMatch) return null;

  const oldPath = pathMatch[1];
  const newPath = pathMatch[2];

  // Determine status
  let status: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';

  if (lines.some(l => l.startsWith('new file mode'))) {
    status = 'added';
  } else if (lines.some(l => l.startsWith('deleted file mode'))) {
    status = 'deleted';
  } else if (oldPath !== newPath) {
    status = 'renamed';
  }

  // Parse chunks
  const chunks: DiffChunk[] = [];
  let currentChunk: DiffChunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse chunk header (@@ -1,5 +1,6 @@)
    if (line.startsWith('@@')) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      const chunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
      if (chunkMatch) {
        currentChunk = {
          oldStart: parseInt(chunkMatch[1]),
          oldLines: parseInt(chunkMatch[2] || '1'),
          newStart: parseInt(chunkMatch[3]),
          newLines: parseInt(chunkMatch[4] || '1'),
          lines: [],
          header: chunkMatch[5]?.trim() || ''
        };
        // Initialize line number counters for this chunk
        oldLineNum = currentChunk.oldStart;
        newLineNum = currentChunk.newStart;
      }
    } else if (currentChunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      // Parse diff lines
      const type = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context';
      const content = line.substring(1);

      currentChunk.lines.push({
        type,
        content,
        oldLineNumber: type !== 'added' ? oldLineNum : undefined,
        newLineNumber: type !== 'removed' ? newLineNum : undefined
      });

      // Increment line numbers for next iteration
      if (type !== 'added') oldLineNum++;
      if (type !== 'removed') newLineNum++;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return {
    path: newPath,
    oldPath: oldPath !== newPath ? oldPath : undefined,
    status,
    chunks,
    language: detectLanguage(newPath)
  };
}

/**
 * Detect programming language from file extension
 */
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'sh': 'bash',
    'yml': 'yaml',
    'yaml': 'yaml',
    'json': 'json',
    'md': 'markdown',
    'sql': 'sql',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'vue': 'vue',
    'svelte': 'svelte'
  };

  return languageMap[ext || ''] || 'unknown';
}
