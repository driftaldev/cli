import React from "react";
import { Banner } from "./Banner.js";

type InkModule = typeof import("ink");

type AppLayoutProps = {
  ink: InkModule;
  version?: string;
  model?: string;
  directory?: string;
  children: React.ReactNode;
};

/**
 * Application layout with fixed banner at top
 *
 * This component wraps the main content with a banner showing:
 * - Brand name (Driftal)
 * - Version
 * - Current model
 * - Current directory
 */
export const AppLayout: React.FC<AppLayoutProps> = ({
  ink,
  version,
  model,
  directory,
  children
}) => {
  const { Box } = ink;

  return (
    <Box flexDirection="column">
      {/* Fixed banner at top */}
      <Banner
        ink={ink}
        version={version}
        model={model}
        directory={directory}
      />

      {/* Main content area */}
      <Box flexDirection="column">
        {children}
      </Box>
    </Box>
  );
};

export default AppLayout;
