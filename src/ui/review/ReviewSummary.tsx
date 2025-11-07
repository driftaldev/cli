import React, { useEffect, useMemo } from "react";
import type { ReviewResults, ReviewIssue, IssueSeverity } from "../../core/review/issue.js";
import { IssueRanker } from "../../core/review/issue.js";

type InkModule = typeof import("ink");

type ReviewSummaryProps = {
  results: ReviewResults;
  ink: InkModule;
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

export const ReviewSummary: React.FC<ReviewSummaryProps> = ({ results, ink }) => {
  const { Box, Text, useApp } = ink;
  const { exit } = useApp();
  const ranker = useMemo(() => new IssueRanker(), []);

  const groupedIssues = useMemo(() => {
    const bySeverity = ranker.groupBySeverity(results.issues);
    return severityOrder.flatMap((severity) => {
      return bySeverity.get(severity)?.map((issue) => ({ severity, issue })) ?? [];
    });
  }, [ranker, results.issues]);

  useEffect(() => {
    const timer = setTimeout(() => exit(), 0);
    return () => clearTimeout(timer);
  }, [exit]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyanBright">Scout Review Summary</Text>
      <Box marginTop={1} flexDirection="column">
        {groupedIssues.length === 0 ? (
          <Box marginTop={1}>
            <Text color="green">No issues found! 🎉</Text>
          </Box>
        ) : (
          groupedIssues.map(({ severity, issue }) => (
            <Box
              key={`${issue.location.file}:${issue.location.line}:${issue.title}`}
              flexDirection="column"
              marginBottom={1}
            >
              <Text color={severityColor[severity]}>{truncate(issue.title, 90)}</Text>
              <Text color="gray">{truncate(formatLocation(issue), 90)}</Text>
              {issue.description && issue.description.trim().length > 0 && (
                <Text color="white">{truncate(issue.description.trim(), 120)}</Text>
              )}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};

export default ReviewSummary;

