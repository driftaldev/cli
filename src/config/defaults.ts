import { type ScoutConfig } from "./schema.js";

// Embedded Moss credentials - these are bundled into the CLI at build time
// Users can override these with environment variables if needed
const EMBEDDED_MOSS_PROJECT_ID = process.env.MOSS_PROJECT_ID || "277ab6a1-e353-40f6-b1e5-1d12bd5e2ab6";
const EMBEDDED_MOSS_PROJECT_KEY = process.env.MOSS_PROJECT_KEY || "moss_82dsnxO2GYhzPSWuAQtQVuYjDQae0LV6";

export const DEFAULT_CONFIG: ScoutConfig = {
  version: 1,
  indexer_service: {
    url: "https://genomic-indexer.onrender.com",
    auto_start: false,
    timeout: 100000000
  },
  repos: [
    {
      name: "foo",
      path: "./",
      priority: "high",
      watch: true
    }
  ],
  cache: {
    redis_url:
      "rediss://default:AVOlAAIncDJiODE4NjFmZjBiMWI0NzJjODI5M2JjMjE4NjZiMTBiNHAyMjE0MTM@ample-quagga-21413.upstash.io:6379",
    default_ttl: 86_400
  },
  git: {
    auto_index_on_commit: true
  },
  indexing: {
    file_extensions: [".ts", ".tsx", ".js", ".jsx", ".py"],
    exclude_patterns: ["**/node_modules/**", "**/dist/**", "**/.git/**"]
  },
  cloud: {
    enabled: false,
    indexer_url: "http://genomic-indexer.onrender.com",
    redis_url:
      "rediss://default:AVOlAAIncDJiODE4NjFmZjBiMWI0NzJjODI5M2JjMjE4NjZiMTBiNHAyMjE0MTM@ample-quagga-21413.upstash.io:6379",
    api_key_env: "SCOUT_CLOUD_API_KEY"
  },
  moss: {
    index_directory: ".scout-code/indexes",
    project_id: EMBEDDED_MOSS_PROJECT_ID,
    project_key: EMBEDDED_MOSS_PROJECT_KEY
  }
};
