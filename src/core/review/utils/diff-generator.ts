import { createPatch } from 'diff';

/**
 * Generates a unified diff from original and fixed code
 * @param originalCode - The original code before the fix
 * @param fixedCode - The fixed code after the change
 * @param context - Number of context lines to include (default: 3)
 * @returns Unified diff string or null if inputs are invalid
 */
export function generateUnifiedDiff(
  originalCode: string,
  fixedCode: string,
  context: number = 3
): string | null {
  // Validate inputs
  if (!originalCode || !fixedCode) {
    return null;
  }

  // If code is identical, no diff needed
  if (originalCode === fixedCode) {
    return null;
  }

  // Generate unified diff patch
  // The createPatch function signature:
  // createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options)
  const patch = createPatch(
    'code',
    originalCode,
    fixedCode,
    '',
    '',
    { context }
  );

  // Remove the file header lines (first 4 lines) from the patch
  // We only want the actual diff content, not the file metadata
  const lines = patch.split('\n');
  const diffLines = lines.slice(4); // Skip: Index, ===, ---, +++

  // Join back and trim
  const diff = diffLines.join('\n').trim();

  return diff || null;
}

/**
 * Checks if a suggestion should use diff format vs simple code additions
 * @param suggestion - The suggestion object
 * @returns true if diff format should be used
 */
export function shouldUseDiff(suggestion: {
  originalCode?: string;
  fixedCode?: string;
  code?: string;
}): boolean {
  // Use diff format if both originalCode and fixedCode are provided
  return !!(suggestion.originalCode && suggestion.fixedCode);
}
