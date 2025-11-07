import type { SearchResponse } from '../indexer/client.js';

export function sortByScore(response: SearchResponse): SearchResponse {
  return {
    ...response,
    results: [...response.results].sort((a, b) => b.score - a.score),
  };
}
