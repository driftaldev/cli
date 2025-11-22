import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "../../utils/logger.js";
import type { SearchCache, SearchCounter } from "../utils/search-cache.js";
import { logToolCallToFile } from "../workflows/review-workflow.js";

/**
 * Input schema for read_test_file tool
 */
const ReadTestFileInputSchema = z.object({
  testFilePath: z
    .string()
    .min(1, "Test file path cannot be empty")
    .describe("Path to the test file to read (relative or absolute)"),
});

/**
 * Output schema for read_test_file tool
 */
const ReadTestFileOutputSchema = z.object({
  success: z.boolean(),
  toolCallsRemaining: z.number().optional(),
  filePath: z.string().optional(),
  content: z.string().optional(),
  testCount: z.number().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

type ReadTestFileInput = z.infer<typeof ReadTestFileInputSchema>;
type ReadTestFileOutput = z.infer<typeof ReadTestFileOutputSchema>;

/**
 * Create read_test_file tool with caching and budget limits
 *
 * @param repoPath - Root path of the repository
 * @param cache - Shared cache for caching results across agents
 * @param counter - Counter to track and limit tool calls per agent
 * @param fileName - Name of the file being analyzed (for logging)
 * @returns Mastra CoreTool compatible object
 */
export function createReadTestFileTool(
  repoPath: string,
  cache: SearchCache,
  counter: SearchCounter,
  fileName: string
) {
  return createTool({
    id: "read_test_file",
    description:
      "Read related test files to understand expected behavior, edge cases, and error handling. Use this REACTIVELY when you see code without clear validation or when you need to verify expected behavior. You have a limited tool budget (2-3 calls), so use strategically.",
    inputSchema: ReadTestFileInputSchema,
    outputSchema: ReadTestFileOutputSchema,

    execute: async ({ context }: { context: ReadTestFileInput }): Promise<ReadTestFileOutput> => {
      const input = context;
      try {
        logger.debug(
          `[ReadTestFileTool] Agent requested test file: "${input.testFilePath}" (${counter.count}/${counter.limit} calls used)`
        );

        // Check if budget exceeded
        if (counter.count >= counter.limit) {
          logger.warn(
            `[ReadTestFileTool] Tool call budget exceeded (${counter.count}/${counter.limit})`
          );
          const result = {
            success: false,
            toolCallsRemaining: 0,
            error: "Tool call budget exceeded",
            message: `You have used all ${counter.limit} tool calls for this file. Focus on analyzing with the context you already have.`,
          };

          await logToolCallToFile(
            fileName,
            "read_test_file",
            input.testFilePath,
            result
          );

          return result;
        }

        // Resolve file path (handle both relative and absolute)
        let testFilePath = input.testFilePath;
        if (!path.isAbsolute(testFilePath)) {
          testFilePath = path.join(repoPath, testFilePath);
        }

        // Check cache first
        const cacheKey = `test_file:${testFilePath}`;
        const cacheParams = {
          query: cacheKey,
          repos: undefined,
          file_types: undefined,
          max_results: undefined,
        };

        if (cache.has(cacheParams)) {
          logger.debug(
            `[ReadTestFileTool] Cache HIT for: "${testFilePath}"`
          );
          const cachedContent = cache.get(cacheParams);

          const result = {
            success: true,
            toolCallsRemaining: counter.limit - counter.count,
            filePath: testFilePath,
            content: cachedContent.content,
            testCount: cachedContent.testCount,
            message: "Test file content from cache (no budget used)",
          };

          await logToolCallToFile(
            fileName,
            "read_test_file",
            input.testFilePath,
            result
          );

          return result;
        }

        // Cache miss - read file
        logger.debug(`[ReadTestFileTool] Cache MISS - reading file`);

        const content = await fs.readFile(testFilePath, "utf-8");

        // Increment counter AFTER successful read
        counter.count++;

        // Count test cases (simple heuristic: count "it(", "test(", "describe(" patterns)
        const testCount =
          (content.match(/\b(it|test|describe)\s*\(/g) || []).length;

        // Cache the result
        cache.set(cacheParams, { content, testCount });

        logger.debug(
          `[ReadTestFileTool] File read complete: ${testFilePath} (${testCount} tests found). ` +
            `Tool calls remaining: ${counter.limit - counter.count}/${counter.limit}`
        );

        const result = {
          success: true,
          toolCallsRemaining: counter.limit - counter.count,
          filePath: testFilePath,
          content: content,
          testCount: testCount,
          message: `Read test file with ${testCount} test cases. You have ${counter.limit - counter.count} tool calls remaining.`,
        };

        await logToolCallToFile(
          fileName,
          "read_test_file",
          input.testFilePath,
          result
        );

        return result;
      } catch (error: any) {
        logger.error(`[ReadTestFileTool] Failed to read test file:`, error);

        const result = {
          success: false,
          toolCallsRemaining: counter.limit - counter.count,
          error: error.message || "Failed to read test file",
          message: `Failed to read test file: ${error.message}. Try a different test file or continue analysis without it.`,
        };

        await logToolCallToFile(
          fileName,
          "read_test_file",
          input.testFilePath,
          result
        );

        return result;
      }
    },
  });
}
