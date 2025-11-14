import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { QueryRouter } from "../query/query-router.js";
import type {
  SearchParams,
  WebIndexRequest,
  WebIndexResponse
} from "../indexer/moss-client.js";
import { buildContext } from "../query/context-builder.js";
import { MossClient } from "../indexer/moss-client.js";
import { fetchSinglePage } from "../indexer/doc-crawler.js";
import type { ScoutConfig } from "../../config/schema.js";

const SearchCodeInputSchema = z.object({
  query: z
    .union([
      z.string(),
      z
        .object({ description: z.string() })
        .transform((value) => value.description)
    ])
    .transform((value) =>
      typeof value === "string" ? value : JSON.stringify(value)
    )
    .refine((value) => value.trim().length > 0, {
      message: "Query cannot be empty"
    }),
  repos: z.array(z.string()).optional(),
  file_types: z.array(z.string()).optional(),
  max_results: z.number().optional()
});

const SearchCodeOutputSchema = z.object({
  context: z.array(
    z.object({
      repo: z.string(),
      filePath: z.string(),
      snippet: z.string(),
      score: z.number(),
      range: z.object({ start: z.number(), end: z.number() }).optional()
    })
  ),
  raw: z.any()
});

export function registerSearchCodeTool(
  server: McpServer,
  router: QueryRouter,
  config: ScoutConfig
): void {
  server.registerTool(
    "search_code",
    {
      title: "Search Code",
      description:
        "Search across indexed codebases with semantic understanding",
      inputSchema: SearchCodeInputSchema.shape,
      outputSchema: SearchCodeOutputSchema.shape
    },
    async (params) => {
      const parsed = SearchCodeInputSchema.parse(params ?? {});
      const searchParams: SearchParams = {
        ...parsed,
        query: parsed.query.trim()
      };

      // Use the router which already has the MossClient
      const response = await router.search(searchParams);
      const context = buildContext(response);

      return {
        structuredContent: {
          context,
          raw: response
        },
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                context,
                raw: response
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

const IndexDocInputSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, { message: "URL cannot be empty" })
    .refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      {
        message: "URL must start with http:// or https://"
      }
    )
    .describe("Documentation URL to crawl and index")
});

const IndexDocOutputSchema = z.object({
  status: z.string(),
  url: z.string(),
  docs_indexed: z.number(),
  message: z.string().optional()
});

export function registerIndexDocTool(
  server: McpServer,
  config: ScoutConfig
): void {
  server.registerTool(
    "index_doc",
    {
      title: "Index Documentation",
      description:
        "Index documentation from a URL using the web indexing service",
      inputSchema: IndexDocInputSchema.shape,
      outputSchema: IndexDocOutputSchema.shape
    },
    async (params) => {
      const parsed = IndexDocInputSchema.parse(params ?? {});

      // Initialize Moss client using credentials from config
      const client = new MossClient(
        config.moss.project_id,
        config.moss.project_key,
        config.moss.index_directory
      );

      // Crawl the URL to get content
      const document = await fetchSinglePage(parsed.url);

      // Index the crawled document
      const payload: WebIndexRequest = {
        url: parsed.url,
        documents: [document]
      };

      const response = await client.webIndex(payload);

      const structured: WebIndexResponse = {
        status: response.status,
        url: response.url,
        docs_indexed: response.docs_indexed,
        message: response.message
      };

      return {
        structuredContent: structured,
        content: [
          {
            type: "text",
            text: JSON.stringify(structured, null, 2)
          }
        ]
      };
    }
  );
}
