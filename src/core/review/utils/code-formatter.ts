let prettierModule: any = null;
let prettierLoadError = false;

/**
 * Lazy load prettier to avoid bundling issues
 */
async function getPrettier() {
  if (prettierLoadError) {
    return null;
  }

  if (prettierModule) {
    return prettierModule;
  }

  try {
    prettierModule = await import('prettier');
    return prettierModule;
  } catch (error) {
    prettierLoadError = true;
    return null;
  }
}

/**
 * Detects the prettier parser from file extension
 */
function getParserFromFilePath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();

  const parserMap: Record<string, string> = {
    'js': 'babel',
    'jsx': 'babel',
    'ts': 'typescript',
    'tsx': 'typescript',
    'json': 'json',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'html': 'html',
    'vue': 'vue',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'graphql': 'graphql',
  };

  return ext ? parserMap[ext] || null : null;
}

/**
 * Formats code using prettier
 * @param code - The code to format
 * @param filePath - The file path (used to detect language)
 * @returns Formatted code, or original code if formatting fails
 */
export async function formatCode(code: string, filePath: string): Promise<string> {
  if (!code || !code.trim()) {
    return code;
  }

  const parser = getParserFromFilePath(filePath);

  // If we can't determine the parser, return original code
  if (!parser) {
    return code;
  }

  try {
    const prettier = await getPrettier();
    if (!prettier) {
      return code;
    }

    const formatted = await prettier.format(code, {
      parser,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
      trailingComma: 'es5',
      printWidth: 100,
    });

    return formatted;
  } catch (error) {
    // If formatting fails, return original code
    // This can happen with incomplete or invalid code snippets
    return code;
  }
}

/**
 * Formats code synchronously using prettier
 * NOTE: This actually returns unformatted code to avoid bundling issues
 * @param code - The code to format
 * @param filePath - The file path (used to detect language)
 * @returns Original code (formatting disabled to avoid bundling issues)
 */
export function formatCodeSync(code: string, filePath: string): string {
  // Due to prettier bundling issues with bun, we skip formatting in sync mode
  // The code will still be readable, just not formatted
  return code;
}
