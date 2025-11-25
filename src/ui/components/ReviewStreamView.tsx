import React from "react";
import { StreamingText } from "./StreamingText.js";
import type { StreamingState } from "../types/stream-events.js";

type InkModule = typeof import("ink");

interface ReviewStreamViewProps {
  ink: InkModule;
  /** Current streaming state */
  state: StreamingState;
  /** Version for banner display */
  version?: string;
  /** Model name for banner display */
  model?: string;
  /** Directory for banner display */
  directory?: string;
}

/**
 * Agent display names and colors
 */
const agentInfo: Record<
  "security" | "performance" | "logic",
  { name: string; color: string; icon: string; tasks: string[] }
> = {
  security: {
    name: "Security",
    color: "red",
    icon: "🔒",
    tasks: [
      "Scanning for injection vulnerabilities",
      "Checking authentication patterns",
      "Analyzing sensitive data exposure",
      "Reviewing crypto implementations",
      "Validating input sanitization",
    ],
  },
  performance: {
    name: "Performance",
    color: "yellow",
    icon: "⚡",
    tasks: [
      "Analyzing algorithm complexity",
      "Checking for N+1 queries",
      "Finding optimization opportunities",
      "Reviewing async patterns",
      "Detecting memory leaks",
    ],
  },
  logic: {
    name: "Logic",
    color: "blue",
    icon: "🧠",
    tasks: [
      "Checking async/await patterns",
      "Finding null reference issues",
      "Analyzing edge cases",
      "Validating type consistency",
      "Detecting unreachable code",
    ],
  },
};

/**
 * Main streaming review UI component.
 * Shows the AI's thinking/reasoning process in real-time,
 * similar to how coding agents display their thought process.
 */
export const ReviewStreamView: React.FC<ReviewStreamViewProps> = ({
  ink,
  state,
}) => {
  const { Box, Text } = ink;

  const {
    currentFile,
    currentAgent,
    thinkingContent,
    isThinking,
    isComplete,
    filesProcessed,
    totalFiles,
  } = state;

  const agent = currentAgent ? agentInfo[currentAgent] : null;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header with progress */}
      <Box marginBottom={1} flexDirection="column">
        {/* Progress bar */}
        {totalFiles > 0 && (
          <Box marginBottom={1}>
            <Text color="gray">
              [{filesProcessed}/{totalFiles}]
            </Text>
            <Text color="cyan">
              {" "}
              {getProgressBar(filesProcessed, totalFiles)}
            </Text>
          </Box>
        )}

        {/* Current file being reviewed */}
        {currentFile && !isComplete && (
          <Box flexDirection="column" marginBottom={1}>
            <Box>
              <Text color="white" bold>
                 {truncatePath(currentFile, 60)}
              </Text>
            </Box>
          </Box>
        )}

        {isComplete && (
          <Text color="green" bold>
            ✓ Analysis complete
          </Text>
        )}
      </Box>

      {/* Main panel - shows reasoning OR animated task list */}
      {!isComplete && currentFile && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={thinkingContent ? "magenta" : "gray"}
          paddingX={1}
          paddingY={1}
        >
          {/* Header */}
          <Box marginBottom={1}>
            {agent && (
              <Text color={agent.color as any} bold>
                {agent.icon} {agent.name} Agent
              </Text>
            )}
            {(isThinking || !thinkingContent) && (
              <Text color="gray">
                {" "}
                <ThinkingDots />
              </Text>
            )}
          </Box>

          {/* Show reasoning if available, otherwise show animated tasks */}
          {thinkingContent ? (
            <Box flexDirection="column">
              <Text color="gray" dimColor>
                Reasoning:
              </Text>
              <Box marginTop={1}>
                <StreamingText
                  ink={ink}
                  text={thinkingContent}
                  color="white"
                  typingSpeed={3}
                  isComplete={!isThinking}
                  maxLines={15}
                />
              </Box>
            </Box>
          ) : (
            agent && <AnimatedTaskList ink={ink} tasks={agent.tasks} />
          )}
        </Box>
      )}

      {/* Waiting state */}
      {!currentFile && !isComplete && (
        <Box>
          <Text color="gray">
            <WorkingSpinner /> Initializing review...
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Animated task list showing what the agent might be doing
 */
const AnimatedTaskList: React.FC<{
  ink: InkModule;
  tasks: string[];
}> = ({ ink, tasks }) => {
  const { Box, Text } = ink;
  const [activeTask, setActiveTask] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setActiveTask((t) => (t + 1) % tasks.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [tasks.length]);

  return (
    <Box flexDirection="column">
      {tasks.map((task, i) => (
        <Box key={i}>
          <Text
            color={i === activeTask ? "cyan" : "gray"}
            dimColor={i !== activeTask}
          >
            {i === activeTask ? "▸ " : "  "}
            {task}
            {i === activeTask && <ThinkingDots />}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

/**
 * Animated thinking dots
 */
const ThinkingDots: React.FC = () => {
  const [dots, setDots] = React.useState(1);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, 350);
    return () => clearInterval(interval);
  }, []);

  return <>{".".repeat(dots)}</>;
};

/**
 * Simple working spinner
 */
const WorkingSpinner: React.FC = () => {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frame, setFrame] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return <>{frames[frame]}</>;
};

/**
 * Create a simple progress bar
 */
function getProgressBar(current: number, total: number): string {
  const width = 20;
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

/**
 * Truncate a file path for display
 */
function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  // Try to show filename and some context
  if (parts.length > 2) {
    const filename = parts[parts.length - 1];
    const dir = parts[parts.length - 2];
    const shortened = `.../${dir}/${filename}`;
    if (shortened.length <= maxLen) return shortened;
    return `.../${filename}`.slice(0, maxLen);
  }
  return "..." + path.slice(-(maxLen - 3));
}

export default ReviewStreamView;
