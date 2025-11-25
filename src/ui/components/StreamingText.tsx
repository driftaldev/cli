import React, { useState, useEffect, useRef } from "react";

type InkModule = typeof import("ink");

interface StreamingTextProps {
  ink: InkModule;
  /** The full text to display (can grow as stream progresses) */
  text: string;
  /** Typing speed in ms per character (default: 15ms for fast streaming) */
  typingSpeed?: number;
  /** Color of the text */
  color?: string;
  /** Whether to show instantly without animation */
  instant?: boolean;
  /** Whether the stream is complete (show all remaining text instantly) */
  isComplete?: boolean;
  /** Maximum lines to display (older lines scroll off) */
  maxLines?: number;
}

/**
 * A component that displays text with a typing animation effect.
 * As new text arrives via the `text` prop, it animates character by character.
 */
export const StreamingText: React.FC<StreamingTextProps> = ({
  ink,
  text,
  typingSpeed = 15,
  color = "white",
  instant = false,
  isComplete = false,
  maxLines = 20,
}) => {
  const { Text, Box } = ink;
  const [displayedLength, setDisplayedLength] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // If instant mode or complete, show all text immediately
    if (instant || isComplete) {
      setDisplayedLength(text.length);
      return;
    }

    // If we need to catch up (new text arrived)
    if (displayedLength < text.length) {
      timerRef.current = setTimeout(() => {
        setDisplayedLength((prev) => Math.min(prev + 1, text.length));
      }, typingSpeed);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [text, displayedLength, typingSpeed, instant, isComplete]);

  // Get the text to display
  const displayText = text.slice(0, displayedLength);

  // Limit to max lines (keep most recent)
  const lines = displayText.split("\n");
  const visibleLines =
    lines.length > maxLines ? lines.slice(-maxLines) : lines;
  const truncatedText = visibleLines.join("\n");

  // Show cursor if still typing
  const showCursor = !isComplete && displayedLength < text.length;

  return (
    <Box flexDirection="column">
      <Text color={color}>
        {truncatedText}
        {showCursor && <Text color="cyan">▊</Text>}
      </Text>
    </Box>
  );
};

export default StreamingText;

