import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { logger } from "../../utils/logger.js";
import type { SearchCache, SearchCounter } from "../utils/search-cache.js";
import type { QueryRouter } from "../../core/query/query-router.js";
import { buildContext } from "../../core/query/context-builder.js";
import { logToolCallToFile } from "../workflows/review-workflow.js";

/**
 * Input schema for find_all_usages tool
 */
const FindAllUsagesInputSchema = z.object({
  identifier: z
    .string()
    .min(1, "Identifier cannot be empty")
    .describe(
      "Function name, variable name, or identifier to search for (e.g., 'validateToken', 'getUserById')"
    ),
  includeDefinition: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to include the definition/declaration of the identifier (default: false, only usages)"
    ),
  maxResults: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum number of usage results to return (default: 10)"),
});

/**
 * Output schema for find_all_usages tool
 */
const FindAllUsagesOutputSchema = z.object({
  success: z.boolean(),
  toolCallsRemaining: z.number().optional(),
  identifier: z.string().optional(),
  usages: z
    .array(
      z.object({
        repo: z.string(),
        filePath: z.string(),
        snippet: z.string(),
        score: z.number(),
        range: z
          .object({ start: z.number(), end: z.number() })
          .optional(),
      })
    )
    .optional(),
  totalUsages: z.number().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

type FindAllUsagesInput = z.infer<typeof FindAllUsagesInputSchema>;
type FindAllUsagesOutput = z.infer<typeof FindAllUsagesOutputSchema>;

/**
 * Create find_all_usages tool with caching and budget limits
 *
 * @param router - QueryRouter instance for semantic search
 * @param cache - Shared cache for caching results across agents
 * @param counter - Counter to track and limit tool calls per agent
 * @param fileName - Name of the file being analyzed (for logging)
 * @returns Mastra CoreTool compatible object
 */
export function createFindAllUsagesTool(
  router: QueryRouter,
  cache: SearchCache,
  counter: SearchCounter,
  fileName: string
) {
  return createTool({
    id: "find_all_usages",
    description:
      "Find all usages of a function, variable, or identifier across the codebase. Use this REACTIVELY when you need to verify consistency (e.g., 'Is this auth check applied everywhere?', 'Do all callers handle null?', 'Is this validation used consistently?'). You have a limited tool budget (2-3 calls), so use strategically.",
    inputSchema: FindAllUsagesInputSchema,
    outputSchema: FindAllUsagesOutputSchema,

    execute: async ({
      context,
    }: {
      context: FindAllUsagesInput;
    }): Promise<FindAllUsagesOutput> => {
      const input = context;
      try {
        logger.debug(
          `[FindAllUsagesTool] Agent requested usages: "${input.identifier}" (${counter.count}/${counter.limit} calls used)`
        );

        // Check if budget exceeded
        if (counter.count >= counter.limit) {
          logger.warn(
            `[FindAllUsagesTool] Tool call budget exceeded (${counter.count}/${counter.limit})`
          );
          const result = {
            success: false,
            toolCallsRemaining: 0,
            error: "Tool call budget exceeded",
            message: `You have used all ${counter.limit} tool calls for this file. Focus on analyzing with the context you already have.`,
          };

          await logToolCallToFile(
            fileName,
            "find_all_usages",
            input.identifier,
            result
          );

          return result;
        }

        // Create search query to find usages
        // We'll search for the identifier name with context words
        const searchQuery = `${input.identifier}`;

        // Prepare search params
        const searchParams = {
          query: searchQuery,
          repos: undefined,
          file_types: undefined,
          max_results: input.maxResults || 10,
        };

        // Check cache first
        const cacheKey = `find_usages:${input.identifier}:${input.maxResults}`;
        const cacheParams = {
          query: cacheKey,
          repos: undefined,
          file_types: undefined,
          max_results: undefined,
        };

        if (cache.has(cacheParams)) {
          logger.debug(
            `[FindAllUsagesTool] Cache HIT for: "${input.identifier}"`
          );
          const cachedResult = cache.get(cacheParams);

          const result = {
            success: true,
            toolCallsRemaining: counter.limit - counter.count,
            identifier: input.identifier,
            usages: cachedResult.usages,
            totalUsages: cachedResult.totalUsages,
            message: `Usages from cache (no budget used). Found ${cachedResult.totalUsages} usages.`,
          };

          await logToolCallToFile(
            fileName,
            "find_all_usages",
            input.identifier,
            result
          );

          return result;
        }

        // Cache miss - perform search
        logger.debug(
          `[FindAllUsagesTool] Cache MISS - searching for usages`
        );

        const response = await router.search(searchParams);
        const context = buildContext(response);

        // Increment counter AFTER successful search
        counter.count++;

        // Filter results to find actual usages (not just mentions)
        const usages = context.map((item) => ({
          repo: item.repo,
          filePath: item.filePath,
          snippet: item.snippet,
          score: item.score,
          range: item.range,
        }));

        // Cache the result
        cache.set(cacheParams, {
          usages,
          totalUsages: usages.length,
        });

        logger.debug(
          `[FindAllUsagesTool] Found ${usages.length} usages of "${input.identifier}". ` +
            `Tool calls remaining: ${counter.limit - counter.count}/${counter.limit}`
        );

        const result = {
          success: true,
          toolCallsRemaining: counter.limit - counter.count,
          identifier: input.identifier,
          usages: usages,
          totalUsages: usages.length,
          message: `Found ${usages.length} usages of "${input.identifier}" across the codebase. You have ${counter.limit - counter.count} tool calls remaining.`,
        };

        await logToolCallToFile(
          fileName,
          "find_all_usages",
          input.identifier,
          result
        );

        return result;
      } catch (error: any) {
        logger.error(`[FindAllUsagesTool] Failed to find usages:`, error);

        const result = {
          success: false,
          toolCallsRemaining: counter.limit - counter.count,
          error: error.message || "Failed to find usages",
          message: `Failed to find usages: ${error.message}. Try a different identifier or continue analysis without this information.`,
        };

        await logToolCallToFile(
          fileName,
          "find_all_usages",
          input.identifier,
          result
        );

        return result;
      }
    },
  });
}
