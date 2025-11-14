// Default indexing constants
// These are used for file scanning and indexing across all repositories

export const DEFAULT_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py"];

export const DEFAULT_EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/.driftal/**"
];

export const DEFAULT_INDEX_DIRECTORY = ".driftal/indexes";
