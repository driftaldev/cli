import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "../../utils/logger.js";
import type { SearchCache, SearchCounter } from "../utils/search-cache.js";
import { logToolCallToFile } from "../workflows/review-workflow.js";

/**
 * Input schema for read_related_files tool
 */
const ReadRelatedFilesInputSchema = z.object({
  directory: z
    .string()
    .optional()
    .describe(
      "Directory to search for related files (defaults to current file's directory)"
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      "File pattern to match (e.g., '*.ts', '*-handler.ts'). Defaults to same extension as current file."
    ),
  maxFiles: z
    .number()
    .optional()
    .default(5)
    .describe("Maximum number of files to read (default: 5)"),
});

/**
 * Output schema for read_related_files tool
 */
const ReadRelatedFilesOutputSchema = z.object({
  success: z.boolean(),
  toolCallsRemaining: z.number().optional(),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
        size: z.number(),
      })
    )
    .optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

type ReadRelatedFilesInput = z.infer<typeof ReadRelatedFilesInputSchema>;
type ReadRelatedFilesOutput = z.infer<typeof ReadRelatedFilesOutputSchema>;

/**
 * Create read_related_files tool with caching and budget limits
 *
 * @param repoPath - Root path of the repository
 * @param currentFilePath - Path of the file being analyzed
 * @param cache - Shared cache for caching results across agents
 * @param counter - Counter to track and limit tool calls per agent
 * @param fileName - Name of the file being analyzed (for logging)
 * @returns Mastra CoreTool compatible object
 */
export function createReadRelatedFilesTool(
  repoPath: string,
  currentFilePath: string,
  cache: SearchCache,
  counter: SearchCounter,
  fileName: string
) {
  return createTool({
    id: "read_related_files",
    description:
      "Read files in the same module/directory to check for consistent patterns, coding styles, and conventions. Use this REACTIVELY when you need to verify if a pattern is applied consistently across a module (e.g., all auth endpoints use same middleware, all handlers have similar error handling). You have a limited tool budget (2-3 calls), so use strategically.",
    inputSchema: ReadRelatedFilesInputSchema,
    outputSchema: ReadRelatedFilesOutputSchema,

    execute: async ({
      context,
    }: {
      context: ReadRelatedFilesInput;
    }): Promise<ReadRelatedFilesOutput> => {
      const input = context;
      try {
        const queryString = `${input.directory || "current dir"} pattern:${input.pattern || "auto"} max:${input.maxFiles}`;

        logger.debug(
          `[ReadRelatedFilesTool] Agent requested related files: "${queryString}" (${counter.count}/${counter.limit} calls used)`
        );

        // Check if budget exceeded
        if (counter.count >= counter.limit) {
          logger.warn(
            `[ReadRelatedFilesTool] Tool call budget exceeded (${counter.count}/${counter.limit})`
          );
          const result = {
            success: false,
            toolCallsRemaining: 0,
            error: "Tool call budget exceeded",
            message: `You have used all ${counter.limit} tool calls for this file. Focus on analyzing with the context you already have.`,
          };

          await logToolCallToFile(
            fileName,
            "read_related_files",
            queryString,
            result
          );

          return result;
        }

        // Determine directory to search
        const currentFileDir = path.dirname(
          path.isAbsolute(currentFilePath)
            ? currentFilePath
            : path.join(repoPath, currentFilePath)
        );
        const searchDir = input.directory
          ? path.isAbsolute(input.directory)
            ? input.directory
            : path.join(repoPath, input.directory)
          : currentFileDir;

        // Determine file pattern
        const currentExt = path.extname(currentFilePath);
        const pattern = input.pattern || `*${currentExt}`;

        // Check cache first
        const cacheKey = `related_files:${searchDir}:${pattern}:${input.maxFiles}`;
        const cacheParams = {
          query: cacheKey,
          repos: undefined,
          file_types: undefined,
          max_results: undefined,
        };

        if (cache.has(cacheParams)) {
          logger.debug(
            `[ReadRelatedFilesTool] Cache HIT for: "${searchDir}" pattern: "${pattern}"`
          );
          const cachedFiles = cache.get(cacheParams);

          const result = {
            success: true,
            toolCallsRemaining: counter.limit - counter.count,
            files: cachedFiles.files,
            message: `Related files from cache (no budget used). Found ${cachedFiles.files.length} files.`,
          };

          await logToolCallToFile(
            fileName,
            "read_related_files",
            queryString,
            result
          );

          return result;
        }

        // Cache miss - read directory and find matching files
        logger.debug(
          `[ReadRelatedFilesTool] Cache MISS - reading directory: ${searchDir}`
        );

        const entries = await fs.readdir(searchDir, { withFileTypes: true });

        // Filter files by pattern
        const matchingFiles: string[] = [];
        const patternRegex = new RegExp(
          pattern.replace(/\*/g, ".*").replace(/\?/g, ".")
        );

        for (const entry of entries) {
          if (
            entry.isFile() &&
            patternRegex.test(entry.name) &&
            entry.name !== path.basename(currentFilePath) // Exclude current file
          ) {
            matchingFiles.push(path.join(searchDir, entry.name));
          }
        }

        // Limit number of files
        const filesToRead = matchingFiles.slice(0, input.maxFiles || 5);

        // Read file contents
        const files = await Promise.all(
          filesToRead.map(async (filePath) => {
            const content = await fs.readFile(filePath, "utf-8");
            const stats = await fs.stat(filePath);
            return {
              path: path.relative(repoPath, filePath),
              content: content,
              size: stats.size,
            };
          })
        );

        // Increment counter AFTER successful read
        counter.count++;

        // Cache the result
        cache.set(cacheParams, { files });

        logger.debug(
          `[ReadRelatedFilesTool] Read ${files.length} related files. ` +
            `Tool calls remaining: ${counter.limit - counter.count}/${counter.limit}`
        );

        const result = {
          success: true,
          toolCallsRemaining: counter.limit - counter.count,
          files: files,
          message: `Read ${files.length} related files in ${path.relative(repoPath, searchDir)}. You have ${counter.limit - counter.count} tool calls remaining.`,
        };

        await logToolCallToFile(
          fileName,
          "read_related_files",
          queryString,
          result
        );

        return result;
      } catch (error: any) {
        logger.error(
          `[ReadRelatedFilesTool] Failed to read related files:`,
          error
        );

        const result = {
          success: false,
          toolCallsRemaining: counter.limit - counter.count,
          error: error.message || "Failed to read related files",
          message: `Failed to read related files: ${error.message}. The directory may not exist or be accessible.`,
        };

        await logToolCallToFile(
          fileName,
          "read_related_files",
          `${input.directory} pattern:${input.pattern}`,
          result
        );

        return result;
      }
    },
  });
}
