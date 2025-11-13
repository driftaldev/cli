import React from "react";

type InkModule = typeof import("ink");

type BannerProps = {
  ink: InkModule;
  version?: string;
  model?: string;
  directory?: string;
};

/**
 * Format model name for display (e.g., "claude-sonnet-4.5" -> "Sonnet 4.5")
 */
function formatModelName(model: string): string {
  // Handle common model name patterns
  const patterns = [
    { regex: /claude-sonnet-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Sonnet ${m[1]}` },
    { regex: /claude-opus-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Opus ${m[1]}` },
    { regex: /claude-haiku-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Haiku ${m[1]}` },
    { regex: /sonnet-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Sonnet ${m[1]}` },
    { regex: /opus-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Opus ${m[1]}` },
    { regex: /haiku-(\d+\.?\d*)/i, format: (m: RegExpMatchArray) => `Haiku ${m[1]}` },
  ];

  for (const pattern of patterns) {
    const match = model.match(pattern.regex);
    if (match) {
      return pattern.format(match);
    }
  }

  // If no pattern matches, return the model name as-is but capitalize first letter
  return model.charAt(0).toUpperCase() + model.slice(1);
}

export const Banner: React.FC<BannerProps> = ({
  ink,
  version = "0.0.1",
  model,
  directory
}) => {
  const { Box, Text } = ink;

  const displayModel = model ? formatModelName(model) : "No model selected";
  const displayDirectory = directory || process.cwd();

  // ASCII art logo - Owl mascot
  const logo = `(o,o)\n/)_(\\\n-"-"-`;

  return (
    <Box flexDirection="row" paddingX={1} paddingY={1} marginBottom={1}>
      {/* Logo */}
      <Box marginRight={2}>
        <Text color="cyan">{logo}</Text>
      </Box>

      {/* Info */}
      <Box flexDirection="column">
        <Text>
          <Text color="white" bold>Driftal</Text>
          <Text color="gray"> v{version}</Text>
        </Text>
        <Text color="gray">{displayModel}</Text>
        <Text color="gray">{displayDirectory}</Text>
      </Box>
    </Box>
  );
};

export default Banner;
