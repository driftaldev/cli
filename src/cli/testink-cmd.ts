import { Command } from "commander";
import React from "react";

import ReviewSummary from "../ui/review/ReviewSummary.js";
import type { ReviewResults } from "../core/review/issue.js";

let inkModule: any | null = null;

async function getInk() {
  if (!inkModule) {
    process.env.DEV = "false";
    // @ts-ignore Ink ESM types are not resolved under current moduleResolution, runtime import is valid
    inkModule = await import("ink");
  }
  return inkModule;
}

function buildDummyResults(): ReviewResults {
  const now = Date.now();

  return {
    timestamp: now,
    filesReviewed: 3,
    duration: 2180,
    analysis: {
      type: "Feature Update",
      complexity: "Medium",
      riskScore: 47,
    },
    issues: [
      {
        id: "dummy-critical-null-guard",
        type: "bug",
        severity: "critical",
        confidence: 0.92,
        title: "Missing null guard when accessing user profile",
        description:
          "`profile` can be undefined during cold starts. Add a guard before reading `profile.email` to avoid runtime crashes.",
        location: {
          file: "src/api/user-profile.ts",
          line: 84,
        },
        suggestion: {
          description: "Abort early when profile is unavailable",
          diff: [
            "@@",
            "- const profile = cache.get(userId)",
            "- return profile.email;",
            "+ const profile = cache.get(userId);",
            "+ if (!profile) {",
            "+   return { status: 404, body: { error: 'Profile not found' } };",
            "+ }",
            "+ return profile.email;",
          ].join("\n"),
          code: "if (!profile) {\n  return { status: 404, body: { error: 'Profile not found' } };\n}\n",
        },
        rationale:
          "Cold path requests return `null` from the cache layer for ~150 ms, which triggers TypeError in production logs.",
        tags: ["null-safety", "runtime"],
      },
      {
        id: "dummy-high-sql",
        type: "security",
        severity: "high",
        confidence: 0.81,
        title: "Unparameterized SQL query allows injection",
        description:
          "The query concatenates user-supplied `teamId`. Use parameter binding to avoid injection risk.",
        location: {
          file: "src/db/team-repo.ts",
          line: 41,
        },
        suggestion: {
          description: "Switch to parameterized query",
          diff: [
            "@@",
            '- const result = await db.query("SELECT * FROM teams WHERE id = " + teamId);',
            "+ const result = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);",
          ].join("\n"),
          code: "const result = await db.query('SELECT * FROM teams WHERE id = $1', [teamId]);",
        },
        rationale:
          "The current string interpolation mirrors a previous incident (INC-1842) where attackers escalated privileges.",
        tags: ["sql", "injection"],
      },
      {
        id: "dummy-medium-cache",
        type: "performance",
        severity: "medium",
        confidence: 0.68,
        title: "Cache layer invalidates too aggressively",
        description:
          "`invalidateUserCache` clears every tenant key. Restrict invalidation to the affected tenant to avoid costly rebuilds.",
        location: {
          file: "src/cache/user-cache.ts",
          line: 118,
        },
        suggestion: {
          description: "Restrict invalidation scope to the affected tenant",
          diff: [
            "@@",
            '- await cache.invalidate("tenant-");',
            "+ await cache.invalidate(`tenant-${tenantId}`);",
          ].join("\n"),
          code: "await cache.invalidate(`tenant-${tenantId}`);",
        },
        rationale:
          "Synthetic benchmarks show a 35% latency spike after the blanket invalidation releases.",
        tags: ["cache", "scalability"],
      },
      {
        id: "dummy-low-logging",
        type: "best-practice",
        severity: "low",
        confidence: 0.74,
        title: "Promote debug logging to info for release monitoring",
        description:
          "The deployment health check currently logs at debug level, making error triage harder in production.",
        location: {
          file: "src/infra/deploy.ts",
          line: 52,
        },
        suggestion: {
          description: "Promote health check log to info",
          diff: [
            "@@",
            "- logger.debug('deployment health check passed');",
            "+ logger.info('deployment health check passed');",
          ].join("\n"),
          code: "logger.info('deployment health check passed');",
        },
        rationale:
          "On-call runbooks expect info-level logs to appear in Grafana panels during incidents.",
        tags: ["observability", "logging"],
      },
    ],
  };
}

export function registerTestInkCommand(program: Command): void {
  program
    .command("testink")
    .description("Render a dummy review summary using Ink for quick UI testing")
    .action(async () => {
      if (!process.stdout.isTTY) {
        console.log(
          "The testink command requires a TTY to render the Ink UI. Please run it in an interactive terminal."
        );
        return;
      }

      const ink = await getInk();
      const results: ReviewResults = buildDummyResults();

      console.log("\nRendering dummy review summary...\n");
      const app = ink.render(
        React.createElement(ReviewSummary, { results, ink })
      );
      await app.waitUntilExit();
      console.log("\nDone.\n");
    });
}
