import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { logger } from "../../utils/logger.js";
import type { SearchCache, SearchCounter } from "../utils/search-cache.js";
import type { QueryRouter } from "../../core/query/query-router.js";
import { buildContext } from "../../core/query/context-builder.js";
import { logToolCallToFile } from "../workflows/review-workflow.js";

/**
 * Input schema for get_function_callers tool
 */
const GetFunctionCallersInputSchema = z.object({
  functionName: z
    .string()
    .min(1, "Function name cannot be empty")
    .describe(
      "Name of the function to find callers for (e.g., 'processData', 'validateUser')"
    ),
  maxResults: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum number of caller results to return (default: 10)"),
});

/**
 * Output schema for get_function_callers tool
 */
const GetFunctionCallersOutputSchema = z.object({
  success: z.boolean(),
  toolCallsRemaining: z.number().optional(),
  functionName: z.string().optional(),
  callers: z
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
  totalCallers: z.number().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

type GetFunctionCallersInput = z.infer<typeof GetFunctionCallersInputSchema>;
type GetFunctionCallersOutput = z.infer<typeof GetFunctionCallersOutputSchema>;

/**
 * Create get_function_callers tool with caching and budget limits
 *
 * @param router - QueryRouter instance for semantic search
 * @param cache - Shared cache for caching results across agents
 * @param counter - Counter to track and limit tool calls per agent
 * @param fileName - Name of the file being analyzed (for logging)
 * @returns Mastra CoreTool compatible object
 */
export function createGetFunctionCallersTool(
  router: QueryRouter,
  cache: SearchCache,
  counter: SearchCounter,
  fileName: string
) {
  return createTool({
    id: "get_function_callers",
    description:
      "Find all functions/places that call a specific function. Use this REACTIVELY to assess impact of changes (e.g., 'Who calls this function?', 'Is this a critical code path?', 'Will this change break callers?'). You have a limited tool budget (1-2 calls), so use strategically on important functions.",
    inputSchema: GetFunctionCallersInputSchema,
    outputSchema: GetFunctionCallersOutputSchema,

    execute: async ({
      context,
    }: {
      context: GetFunctionCallersInput;
    }): Promise<GetFunctionCallersOutput> => {
      const input = context;
      try {
        logger.debug(
          `[GetFunctionCallersTool] Agent requested callers: "${input.functionName}" (${counter.count}/${counter.limit} calls used)`
        );

        // Check if budget exceeded
        if (counter.count >= counter.limit) {
          logger.warn(
            `[GetFunctionCallersTool] Tool call budget exceeded (${counter.count}/${counter.limit})`
          );
          const result = {
            success: false,
            toolCallsRemaining: 0,
            error: "Tool call budget exceeded",
            message: `You have used all ${counter.limit} tool calls for this file. Focus on analyzing with the context you already have.`,
          };

          await logToolCallToFile(
            fileName,
            "get_function_callers",
            input.functionName,
            result
          );

          return result;
        }

        // Create search query to find function calls
        // Search for function name followed by parentheses
        const searchQuery = `${input.functionName}(`;

        // Prepare search params
        const searchParams = {
          query: searchQuery,
          repos: undefined,
          file_types: undefined,
          max_results: input.maxResults || 10,
        };

        // Check cache first
        const cacheKey = `function_callers:${input.functionName}:${input.maxResults}`;
        const cacheParams = {
          query: cacheKey,
          repos: undefined,
          file_types: undefined,
          max_results: undefined,
        };

        if (cache.has(cacheParams)) {
          logger.debug(
            `[GetFunctionCallersTool] Cache HIT for: "${input.functionName}"`
          );
          const cachedResult = cache.get(cacheParams);

          const result = {
            success: true,
            toolCallsRemaining: counter.limit - counter.count,
            functionName: input.functionName,
            callers: cachedResult.callers,
            totalCallers: cachedResult.totalCallers,
            message: `Callers from cache (no budget used). Found ${cachedResult.totalCallers} callers.`,
          };

          await logToolCallToFile(
            fileName,
            "get_function_callers",
            input.functionName,
            result
          );

          return result;
        }

        // Cache miss - perform search
        logger.debug(
          `[GetFunctionCallersTool] Cache MISS - searching for callers`
        );

        const response = await router.search(searchParams);
        const context = buildContext(response);

        // Increment counter AFTER successful search
        counter.count++;

        // Map results to caller format
        const callers = context.map((item) => ({
          repo: item.repo,
          filePath: item.filePath,
          snippet: item.snippet,
          score: item.score,
          range: item.range,
        }));

        // Cache the result
        cache.set(cacheParams, {
          callers,
          totalCallers: callers.length,
        });

        logger.debug(
          `[GetFunctionCallersTool] Found ${callers.length} callers of "${input.functionName}". ` +
            `Tool calls remaining: ${counter.limit - counter.count}/${counter.limit}`
        );

        const result = {
          success: true,
          toolCallsRemaining: counter.limit - counter.count,
          functionName: input.functionName,
          callers: callers,
          totalCallers: callers.length,
          message: `Found ${callers.length} places calling "${input.functionName}". You have ${counter.limit - counter.count} tool calls remaining.`,
        };

        await logToolCallToFile(
          fileName,
          "get_function_callers",
          input.functionName,
          result
        );

        return result;
      } catch (error: any) {
        logger.error(
          `[GetFunctionCallersTool] Failed to find callers:`,
          error
        );

        const result = {
          success: false,
          toolCallsRemaining: counter.limit - counter.count,
          error: error.message || "Failed to find callers",
          message: `Failed to find callers: ${error.message}. Try a different function name or continue analysis without this information.`,
        };

        await logToolCallToFile(
          fileName,
          "get_function_callers",
          input.functionName,
          result
        );

        return result;
      }
    },
  });
}
