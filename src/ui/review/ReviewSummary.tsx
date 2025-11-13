import React, { useMemo } from "react";
import type { ReviewResults, ReviewIssue, IssueSeverity } from "../../core/review/issue.js";
import { IssueRanker } from "../../core/review/issue.js";

type InkModule = typeof import("ink");

type ReviewSummaryProps = {
  results: ReviewResults;
  ink: InkModule;
  durationSeconds?: string;
};

const severityOrder: IssueSeverity[] = ["critical", "high", "medium", "low", "info"];

const severityColor: Record<IssueSeverity, string> = {
  critical: "red",
  high: "redBright",
  medium: "yellow",
  low: "blueBright",
  info: "gray"
};

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

function formatLocation(issue: ReviewIssue): string {
  return `${issue.location.file}:${issue.location.line}`;
}

function DiffBlock({
  diff,
  Box,
  Text,
}: {
  diff: string;
  Box: InkModule["Box"];
  Text: InkModule["Text"];
}): JSX.Element {
  const lines = diff
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff")) {
        return { line, color: "gray" as const };
      }
      if (line.startsWith("@@")) {
        return { line, color: "magenta" as const };
      }
      if (line.startsWith("+")) {
        return { line, color: "green" as const };
      }
      if (line.startsWith("-")) {
        return { line, color: "red" as const };
      }
      return { line, color: "gray" as const };
    });

  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((entry, idx) => (
        <Text key={idx} color={entry.color}>
          {entry.line}
        </Text>
      ))}
    </Box>
  );
}

export const ReviewSummary: React.FC<ReviewSummaryProps> = ({ results, ink, durationSeconds }) => {
  const { Box, Text, useApp, useInput } = ink;
  const { exit } = useApp();
  const ranker = useMemo(() => new IssueRanker(), []);

  const groupedIssues = useMemo(() => {
    const bySeverity = ranker.groupBySeverity(results.issues);
    return severityOrder.flatMap((severity) => {
      return bySeverity.get(severity)?.map((issue) => ({ severity, issue })) ?? [];
    });
  }, [ranker, results.issues]);

  // Exit when user presses any key
  useInput(() => {
    exit();
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyanBright">Scout Review Summary</Text>
      <Box marginTop={1} flexDirection="column">
        {groupedIssues.length === 0 ? (
          <Box marginTop={1}>
            <Text color="green">No issues found! 🎉</Text>
          </Box>
        ) : (
          groupedIssues.map(({ severity, issue }) => {
            const suggestion =
              typeof issue.suggestion !== "string" && issue.suggestion
                ? issue.suggestion
                : undefined;
            const diffContent = suggestion
              ? suggestion.diff?.trim() && suggestion.diff.trim().length > 0
                ? suggestion.diff.trim()
                : suggestion.code
                ? suggestion.code
                    .split("\n")
                    .map((line) => `+ ${line}`)
                    .join("\n")
                : undefined
              : undefined;

            return (
              <Box
                key={`${issue.location.file}:${issue.location.line}:${issue.title}`}
                flexDirection="column"
                marginBottom={1}
                paddingX={1}
                paddingY={1}
                borderStyle="round"
                borderColor={severityColor[severity]}
              >
                <Text color={severityColor[severity]}>{issue.title}</Text>
                <Text color="gray">{formatLocation(issue)}</Text>
                {issue.description && issue.description.trim().length > 0 && (
                  <Text color="white">{issue.description.trim()}</Text>
                )}
                {diffContent && <DiffBlock diff={diffContent} Box={Box} Text={Text} />}
              </Box>
            );
          })
        )}
      </Box>

      {/* Footer with duration and exit instruction */}
      <Box marginTop={1} flexDirection="column">
        {durationSeconds && (
          <Text color="green">Review completed in {durationSeconds}s</Text>
        )}
        <Text color="gray" dimColor>Press Ctrl + C to exit...</Text>
      </Box>
    </Box>
  );
};

export default ReviewSummary;

