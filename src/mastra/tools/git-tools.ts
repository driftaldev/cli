import { z } from "zod";
import simpleGit from "simple-git";

/**
 * Git integration tools for providing context to agents
 */

/**
 * Get git blame information for a file
 */
export const getBlameInfoTool = {
  id: 'get-blame-info',
  description: 'Get git blame information to understand who wrote the code and when',
  inputSchema: z.object({
    repoPath: z.string().describe('Path to the repository'),
    filePath: z.string().describe('Path to the file'),
    lineStart: z.number().describe('Start line number'),
    lineEnd: z.number().describe('End line number')
  }),
  execute: async ({ repoPath, filePath, lineStart, lineEnd }: {
    repoPath: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
  }) => {
    try {
      const git = simpleGit(repoPath);
      const blame = await git.raw([
        'blame',
        '-L', `${lineStart},${lineEnd}`,
        '--line-porcelain',
        filePath
      ]);

      // Parse blame output to extract author and date info
      const lines = blame.split('\n');
      const authors = new Set<string>();
      const dates: string[] = [];

      for (const line of lines) {
        if (line.startsWith('author ')) {
          authors.add(line.substring(7));
        }
        if (line.startsWith('author-time ')) {
          const timestamp = parseInt(line.substring(12));
          dates.push(new Date(timestamp * 1000).toISOString());
        }
      }

      return {
        authors: Array.from(authors),
        firstModified: dates.length > 0 ? dates[dates.length - 1] : null,
        lastModified: dates.length > 0 ? dates[0] : null,
        totalAuthors: authors.size
      };
    } catch (error) {
      return {
        error: 'Failed to get blame information',
        authors: [],
        firstModified: null,
        lastModified: null,
        totalAuthors: 0
      };
    }
  }
};

/**
 * Get file history to understand change patterns
 */
export const getFileHistoryTool = {
  id: 'get-file-history',
  description: 'Get the commit history for a file to understand change patterns',
  inputSchema: z.object({
    repoPath: z.string().describe('Path to the repository'),
    filePath: z.string().describe('Path to the file'),
    limit: z.number().default(10).describe('Number of commits to retrieve')
  }),
  execute: async ({ repoPath, filePath, limit }: {
    repoPath: string;
    filePath: string;
    limit: number;
  }) => {
    try {
      const git = simpleGit(repoPath);
      const log = await git.log({
        file: filePath,
        maxCount: limit
      });

      const commits = log.all.map(commit => ({
        hash: commit.hash.substring(0, 7),
        author: commit.author_name,
        date: commit.date,
        message: commit.message
      }));

      // Analyze change frequency
      const now = new Date();
      const recentChanges = commits.filter(c => {
        const commitDate = new Date(c.date);
        const daysDiff = (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysDiff <= 30;
      });

      return {
        commits,
        totalCommits: log.total,
        recentChanges: recentChanges.length,
        changeFrequency: recentChanges.length > 5 ? 'high' : recentChanges.length > 2 ? 'medium' : 'low',
        isStable: recentChanges.length < 3
      };
    } catch (error) {
      return {
        error: 'Failed to get file history',
        commits: [],
        totalCommits: 0,
        recentChanges: 0,
        changeFrequency: 'unknown',
        isStable: false
      };
    }
  }
};

/**
 * Identify author expertise based on contributions
 */
export const getAuthorExpertiseTool = {
  id: 'get-author-expertise',
  description: 'Determine author expertise in specific file or module',
  inputSchema: z.object({
    repoPath: z.string().describe('Path to the repository'),
    filePath: z.string().describe('Path to the file or module'),
    author: z.string().describe('Author name or email')
  }),
  execute: async ({ repoPath, filePath, author }: {
    repoPath: string;
    filePath: string;
    author: string;
  }) => {
    try {
      const git = simpleGit(repoPath);

      // Get total commits for the file
      const allLog = await git.log({ file: filePath });

      // Get commits by this author
      const authorLog = await git.log({
        file: filePath,
        '--author': author
      });

      const totalCommits = allLog.total;
      const authorCommits = authorLog.total;
      const expertiseLevel = totalCommits > 0 ? (authorCommits / totalCommits) : 0;

      let level: string;
      if (expertiseLevel > 0.5) level = 'expert';
      else if (expertiseLevel > 0.25) level = 'experienced';
      else if (expertiseLevel > 0.1) level = 'familiar';
      else level = 'novice';

      return {
        author,
        totalCommits,
        authorCommits,
        expertisePercentage: Math.round(expertiseLevel * 100),
        expertiseLevel: level,
        isMainContributor: expertiseLevel > 0.5
      };
    } catch (error) {
      return {
        error: 'Failed to get author expertise',
        author,
        totalCommits: 0,
        authorCommits: 0,
        expertisePercentage: 0,
        expertiseLevel: 'unknown',
        isMainContributor: false
      };
    }
  }
};

export const gitTools = {
  getBlameInfo: getBlameInfoTool,
  getFileHistory: getFileHistoryTool,
  getAuthorExpertise: getAuthorExpertiseTool
};
