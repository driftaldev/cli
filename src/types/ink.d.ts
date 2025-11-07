import type React from "react";

declare module "ink" {
  export type InkApp = {
    waitUntilExit(): Promise<void>;
  };

  export const Box: React.ComponentType<any>;
  export const Text: React.ComponentType<any>;
  export function useApp(): { exit(): void };
  export function render(node: React.ReactElement): InkApp;
}


