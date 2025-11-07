import { Command } from "commander";

import { CacheMetrics } from "../core/cache/metrics.js";
import { logger } from "../utils/logger.js";

export function registerStatsCommand(
  program: Command,
  metrics: CacheMetrics
): void {
  program
    .command("stats")
    .option("--json", "Output as JSON", false)
    .description("Show cache statistics and cost savings")
    .action((options) => {
      const snapshot = metrics.snapshot();
      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      logger.info(`Cache hits: ${snapshot.cacheHits}`);
      logger.info(`Cache misses: ${snapshot.cacheMisses}`);
      logger.info(`Indexer calls: ${snapshot.indexerCalls}`);
      if (snapshot.lastIndexerCallDurationMs !== undefined) {
        logger.info(
          `Last indexer call duration: ${snapshot.lastIndexerCallDurationMs}ms`
        );
      }
    });
}
