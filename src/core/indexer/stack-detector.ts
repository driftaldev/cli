import fs from "fs/promises";
import path from "path";

export type Stack = "nodejs" | "python" | "rust" | "go" | "java" | "general";

interface StackMarker {
  stack: Stack;
  files: string[];
}

const STACK_MARKERS: StackMarker[] = [
  { stack: "nodejs", files: ["package.json"] },

  {
    stack: "python",
    files: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"],
  },
  { stack: "rust", files: ["Cargo.toml"] },
  { stack: "go", files: ["go.mod"] },
  { stack: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts"] },
];

/**
 * Detects which technology stacks are used in a project by checking for marker files
 * @param projectRoot The root directory of the project
 * @returns Array of detected stacks
 */
export async function detectStacks(projectRoot: string): Promise<Stack[]> {
  const detectedStacks: Stack[] = [];

  for (const marker of STACK_MARKERS) {
    for (const file of marker.files) {
      const filePath = path.join(projectRoot, file);
      try {
        await fs.access(filePath);
        // File exists, add this stack if not already added
        if (!detectedStacks.includes(marker.stack)) {
          detectedStacks.push(marker.stack);
        }
        break; // Found one marker for this stack, no need to check others
      } catch {
        // File doesn't exist, continue checking
      }
    }
  }

  // Always include general patterns
  if (!detectedStacks.includes("general")) {
    detectedStacks.push("general");
  }

  return detectedStacks;
}
