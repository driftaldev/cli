import { Agent } from "@mastra/core";
import type { AgentModelConfig } from "../types.js";
import {
  LogicIssuesResponseSchema,
  SecurityIssuesResponseSchema,
  PerformanceIssuesResponseSchema,
} from "../schemas/issue-schema.js";
import { logger } from "../../utils/logger.js";

const OUTPUT_PARSER_INSTRUCTIONS = `You are a precise data formatting expert. Your sole job is to extract code review issues from a text report and format them into strict JSON.

You will receive a text report containing code analysis findings. You must parse this report and output a JSON object matching the required schema.

Rules:
1. Extract all issues found in the report.
2. Ensure all fields (title, description, location, etc.) are correctly populated.
3. Map severity levels to: critical, high, medium, low, info.
4. Map types to the correct issue type (bug, security, performance).
5. Do not hallucinate new issues. Only report what is in the text.
6. If the report says "No issues found", return an empty issues array.
`;

/**
 * Create the output parser agent
 */
export function createOutputParserAgent(modelConfig: AgentModelConfig) {
  return new Agent({
    name: "output-parser",
    instructions: OUTPUT_PARSER_INSTRUCTIONS,
    model: modelConfig,
  });
}

/**
 * Parse a logic analysis report into structured JSON
 */
export async function parseLogicReport(
  agent: Agent,
  reportText: string
): Promise<any[]> {
  try {
    const result = await agent.generate(
      `Parse the following Logic Analysis Report into JSON:\n\n${reportText}`,
      {
        structuredOutput: {
          schema: LogicIssuesResponseSchema,
          errorStrategy: "warn",
          jsonPromptInjection: true,
        },
        modelSettings: {
          temperature: 0, // Deterministic
        },
      }
    );

    if (result.object && result.object.issues) {
      return result.object.issues;
    }
    return [];
  } catch (error) {
    logger.error("Failed to parse logic report:", error);
    return [];
  }
}

/**
 * Parse a security analysis report into structured JSON
 */
export async function parseSecurityReport(
  agent: Agent,
  reportText: string
): Promise<any[]> {
  try {
    const result = await agent.generate(
      `Parse the following Security Analysis Report into JSON:\n\n${reportText}`,
      {
        structuredOutput: {
          schema: SecurityIssuesResponseSchema,
          errorStrategy: "warn",
          jsonPromptInjection: true,
        },
        modelSettings: {
          temperature: 0, // Deterministic
        },
      }
    );

    if (result.object && result.object.issues) {
      return result.object.issues;
    }
    return [];
  } catch (error) {
    logger.error("Failed to parse security report:", error);
    return [];
  }
}

/**
 * Parse a performance analysis report into structured JSON
 */
export async function parsePerformanceReport(
  agent: Agent,
  reportText: string
): Promise<any[]> {
  try {
    const result = await agent.generate(
      `Parse the following Performance Analysis Report into JSON:\n\n${reportText}`,
      {
        structuredOutput: {
          schema: PerformanceIssuesResponseSchema,
          errorStrategy: "warn",
          jsonPromptInjection: true,
        },
        modelSettings: {
          temperature: 0, // Deterministic
        },
      }
    );

    if (result.object && result.object.issues) {
      return result.object.issues;
    }
    return [];
  } catch (error) {
    logger.error("Failed to parse performance report:", error);
    return [];
  }
}
