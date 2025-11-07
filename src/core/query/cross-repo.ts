import type { SearchResponse } from '../indexer/client.js';

interface CrossRepoResult {
  repo: string;
  results: SearchResponse;
}

export function groupByRepo(response: SearchResponse): CrossRepoResult[] {
  const map = new Map<string, SearchResponse['results']>();
  for (const result of response.results) {
    if (!map.has(result.repo)) {
      map.set(result.repo, []);
    }
    map.get(result.repo)!.push(result);
  }

  return Array.from(map.entries()).map(([repo, results]) => ({
    repo,
    results: {
      results,
      total: results.length,
      duration_ms: response.duration_ms,
    },
  }));
}
