import type {
  MossClient,
  SearchParams,
  SearchResponse
} from "../indexer/moss-client.js";
import { RedisCache } from "../cache/redis-cache.js";
import { CacheMetrics } from "../cache/metrics.js";

export class QueryRouter {
  constructor(
    private readonly client: MossClient,
    private readonly cache: RedisCache<SearchResponse>,
    private readonly metrics: CacheMetrics,
    private readonly defaultRepoName?: string
  ) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    const resolvedParams: SearchParams = {
      ...params,
      repos: params.repos ? [...params.repos] : undefined
    };
    if (
      (!resolvedParams.repos ||
        resolvedParams.repos.length === 0 ||
        !resolvedParams.repos[0].trim()) &&
      this.defaultRepoName
    ) {
      resolvedParams.repos = [this.defaultRepoName];
    }

    const key = JSON.stringify(resolvedParams);
    const cached = await this.cache.get(key);
    if (cached) {
      this.metrics.recordCacheHit();
      return cached;
    }

    this.metrics.recordCacheMiss();
    const start = Date.now();
    const response = await this.client.search(resolvedParams);
    const duration = Date.now() - start;
    this.metrics.recordIndexerCall(duration);
    await this.cache.set(key, response);
    return response;
  }
}
