#!/usr/bin/env node

// Force the working directory to where the user ran the command
const userCwd = process.env.INIT_CWD || process.cwd();
try {
  process.chdir(userCwd);
  // console.log("[DEBUG] Changed working directory to:", process.cwd());
} catch (e) {
  const error = e as Error;
  console.warn("[ScoutCode] Could not change working directory:", error.message);
}

import { Command } from "commander";

import { registerInitCommand } from "./init.js";
import { registerIndexCommand } from "./index-cmd.js";
import { registerServeCommand } from "./serve.js";
import { registerChatCommand } from "./chat-cmd.js";
import { registerStatsCommand } from "./stats.js";
import { createReviewCommand } from "./review-cmd.js";
import { createMemoryCommand } from "./memory-cmd.js";
import { registerLoginCommand } from "./login-cmd.js";
import { registerLogoutCommand } from "./logout-cmd.js";
import { registerModelsCommand } from "./models-cmd.js";
import { CacheMetrics } from "../core/cache/metrics.js";
import { registerTestInkCommand } from "./testink-cmd.js";

const program = new Command();
const metrics = new CacheMetrics();

program.name("scout-code").description("Scout Code CLI and MCP server");

// Authentication commands
registerLoginCommand(program);
registerLogoutCommand(program);
registerModelsCommand(program);

// Other commands
registerInitCommand(program);
registerIndexCommand(program);
registerServeCommand(program, metrics);
registerChatCommand(program);
registerStatsCommand(program, metrics);

// Register review and memory commands
program
  .addCommand(createReviewCommand())
  .addCommand(createMemoryCommand());

registerTestInkCommand(program);

program.parseAsync(process.argv);
