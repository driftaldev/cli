export interface CacheMetricsSnapshot {
  cacheHits: number;
  cacheMisses: number;
  indexerCalls: number;
  lastIndexerCallDurationMs?: number;
}

export class CacheMetrics {
  private cacheHits = 0;
  private cacheMisses = 0;
  private indexerCalls = 0;
  private lastIndexerCallDurationMs?: number;

  recordCacheHit() {
    this.cacheHits += 1;
  }

  recordCacheMiss() {
    this.cacheMisses += 1;
  }

  recordIndexerCall(durationMs: number) {
    this.indexerCalls += 1;
    this.lastIndexerCallDurationMs = durationMs;
  }

  snapshot(): CacheMetricsSnapshot {
    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      indexerCalls: this.indexerCalls,
      lastIndexerCallDurationMs: this.lastIndexerCallDurationMs
    };
  }
}
