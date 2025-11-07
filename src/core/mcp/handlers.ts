import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { QueryRouter } from "../query/query-router.js";
import type { ScoutConfig } from "../../config/schema.js";
import { registerIndexDocTool, registerSearchCodeTool } from "./tools.js";

export function registerTools(
  server: McpServer,
  router: QueryRouter,
  config: ScoutConfig
): void {
  registerSearchCodeTool(server, router, config);
  registerIndexDocTool(server, config);
}
