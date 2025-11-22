import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import type { QueryRouter } from "../../core/query/query-router.js";
import type { SearchParams } from "../../core/indexer/moss-client.js";
import { buildContext } from "../../core/query/context-builder.js";
import { logger } from "../../utils/logger.js";
import type { SearchCache, SearchCounter } from "../utils/search-cache.js";
import { logToolCallToFile } from "../workflows/review-workflow.js";

/**
 * Input schema for search_code tool (Mastra format)
 * Simplified from MCP version for agent use
 */
const SearchCodeInputSchema = z.object({
  query: z
    .string()
    .min(1, "Query cannot be empty")
    .describe(
      "Search query to find relevant code. Use natural language or keywords."
    ),
  repos: z
    .array(z.string())
    .optional()
    .describe("Optional: Filter to specific repositories"),
  file_types: z
    .array(z.string())
    .optional()
    .describe("Optional: Filter to specific file extensions (e.g., ['ts', 'js'])"),
  max_results: z
    .number()
    .optional()
    .default(5)
    .describe("Maximum number of results (default: 5)"),
});

/**
 * Output schema for search_code tool
 */
const SearchCodeOutputSchema = z.object({
  success: z.boolean(),
  searchesRemaining: z.number().optional(),
  results: z
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
  error: z.string().optional(),
  message: z.string().optional(),
});

type SearchCodeInput = z.infer<typeof SearchCodeInputSchema>;
type SearchCodeOutput = z.infer<typeof SearchCodeOutputSchema>;

/**
 * Create a Mastra-compatible search_code tool with caching and budget limits
 *
 * @param router - QueryRouter instance for performing searches
 * @param cache - Shared SearchCache for caching results across agents
 * @param counter - SearchCounter to track and limit searches per agent
 * @param fileName - Name of the file being analyzed (for logging)
 * @returns Mastra CoreTool compatible object
 */
export function createSearchCodeTool(
  router: QueryRouter,
  cache: SearchCache,
  counter: SearchCounter,
  fileName: string
) {
  return createTool({
    id: "search_code",
    description:
      "Search across indexed codebases with semantic understanding. Use this tool REACTIVELY when you identify suspicious patterns that need verification. You have a limited search budget (3-5 searches per file), so use strategically.",
    inputSchema: SearchCodeInputSchema,
    outputSchema: SearchCodeOutputSchema,

    execute: async ({ context }: { context: SearchCodeInput }): Promise<SearchCodeOutput> => {
      const input = context;
      try {
        logger.debug(
          `[SearchCodeTool] Agent requested search: "${input.query}" (${counter.count}/${counter.limit} searches used)`
        );

        // Check if budget exceeded
        if (counter.count >= counter.limit) {
          logger.warn(
            `[SearchCodeTool] Search budget exceeded (${counter.count}/${counter.limit})`
          );
          const result = {
            success: false,
            searchesRemaining: 0,
            error: "Search budget exceeded",
            message: `You have used all ${counter.limit} searches for this file. Focus on analyzing with the context you already have.`,
          };

          // Log budget exceeded
          await logToolCallToFile(fileName, "search_code", input.query, result);

          return result;
        }

        // Prepare search params
        const searchParams: SearchParams = {
          query: input.query.trim(),
          repos: input.repos,
          file_types: input.file_types,
          max_results: input.max_results || 5,
        };

        // Check cache first
        if (cache.has(searchParams)) {
          logger.debug(
            `[SearchCodeTool] Cache HIT for query: "${input.query}"`
          );
          const cachedResult = cache.get(searchParams);

          const result = {
            success: true,
            searchesRemaining: counter.limit - counter.count,
            results: cachedResult.context || [],
            message: "Results from cache (no search budget used)",
          };

          // Log tool call
          await logToolCallToFile(
            fileName,
            "search_code",
            input.query,
            result
          );

          return result;
        }

        // Cache miss - perform actual search
        logger.debug(`[SearchCodeTool] Cache MISS - executing search`);

        const response = await router.search(searchParams);
        const context = buildContext(response);

        // Increment counter AFTER successful search
        counter.count++;

        // Cache the result for other agents
        cache.set(searchParams, { context, raw: response });

        logger.debug(
          `[SearchCodeTool] Search complete: ${context.length} results found. ` +
            `Searches remaining: ${counter.limit - counter.count}/${counter.limit}`
        );

        const result = {
          success: true,
          searchesRemaining: counter.limit - counter.count,
          results: context,
          message: `Found ${context.length} relevant code snippets. You have ${counter.limit - counter.count} searches remaining.`,
        };

        // Log tool call
        await logToolCallToFile(fileName, "search_code", input.query, result);

        return result;
      } catch (error: any) {
        logger.error(`[SearchCodeTool] Search failed:`, error);

        const result = {
          success: false,
          searchesRemaining: counter.limit - counter.count,
          error: error.message || "Search failed",
          message: `Search failed: ${error.message}. Try rephrasing your query or continue analysis without this search.`,
        };

        // Log error
        await logToolCallToFile(fileName, "search_code", input.query, result);

        return result;
      }
    },
  });
}
