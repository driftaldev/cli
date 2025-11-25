import React from "react";
import { StreamingText } from "./StreamingText.js";

type InkModule = typeof import("ink");

interface ThinkingBlockProps {
  ink: InkModule;
  /** The thinking/reasoning content to display */
  content: string;
  /** Whether currently receiving thinking content */
  isActive: boolean;
  /** Whether the thinking phase is complete */
  isComplete?: boolean;
  /** Maximum lines to show */
  maxLines?: number;
  /** Title to display */
  title?: string;
}

/**
 * Displays the AI's reasoning/thinking process in a prominent, styled block.
 * Shows the thought process in real-time, similar to how coding agents work.
 */
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  ink,
  content,
  isActive,
  isComplete = false,
  maxLines = 12,
  title = "Reasoning",
}) => {
  const { Box, Text } = ink;

  // Don't render if no content and not active
  if (!content && !isActive) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isActive ? "magenta" : "gray"}
      paddingX={1}
      paddingY={1}
      marginBottom={1}
    >
      {/* Header with animated indicator */}
      <Box marginBottom={1}>
        <Text color={isActive ? "magenta" : "gray"} bold={isActive}>
          💭 {title}
        </Text>
        {isActive && !isComplete && (
          <Text color="magenta">
            {" "}
            <PulsingDots />
          </Text>
        )}
        {isComplete && !isActive && (
          <Text color="gray" dimColor>
            {" "}
            (done)
          </Text>
        )}
      </Box>

      {/* Thinking content with streaming animation */}
      {content ? (
        <Box flexDirection="column">
          <StreamingText
            ink={ink}
            text={content}
            color="white"
            typingSpeed={3}
            isComplete={isComplete || !isActive}
            maxLines={maxLines}
          />
        </Box>
      ) : (
        isActive && (
          <Text color="gray" dimColor>
            Processing...
          </Text>
        )
      )}
    </Box>
  );
};

/**
 * Animated pulsing dots for active thinking state
 */
const PulsingDots: React.FC = () => {
  const [dots, setDots] = React.useState(1);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, 350);
    return () => clearInterval(interval);
  }, []);

  return <>{".".repeat(dots)}</>;
};

export default ThinkingBlock;
