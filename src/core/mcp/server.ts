import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { QueryRouter } from "../query/query-router.js";
import type { ScoutConfig } from "../../config/schema.js";
import { registerTools } from "./handlers.js";

export function createMcpServer(
  router: QueryRouter,
  config: ScoutConfig
): McpServer {
  const server = new McpServer({
    name: "scout-code",
    version: "0.1.0"
  });

  registerTools(server, router, config);

  return server;
}
