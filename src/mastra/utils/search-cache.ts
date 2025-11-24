import crypto from "crypto";
import type { SearchParams } from "../../core/indexer/moss-client.js";

/**
 * Search result cache for sharing results across agents
 * During a single file review, all 3 agents can benefit from cached searches
 */
export class SearchCache {
  private cache: Map<string, any>;
  private createdAt: number;
  private ttl: number; // milliseconds

  constructor(ttlMinutes: number = 30) {
    this.cache = new Map();
    this.createdAt = Date.now();
    this.ttl = ttlMinutes * 60 * 1000;
  }

  /**
   * Generate cache key from search parameters
   */
  private getCacheKey(params: SearchParams): string {
    // Create deterministic key from search params
    const keyData = {
      query: params.query.trim().toLowerCase(),
      repos: params.repos?.sort() || [],
      file_types: params.file_types?.sort() || [],
      max_results: params.max_results || 10,
    };

    const keyString = JSON.stringify(keyData);
    return crypto.createHash("sha256").update(keyString).digest("hex");
  }

  /**
   * Check if cache has result for given params
   */
  has(params: SearchParams): boolean {
    // Check if cache expired
    if (Date.now() - this.createdAt > this.ttl) {
      this.clear();
      return false;
    }

    const key = this.getCacheKey(params);
    return this.cache.has(key);
  }

  /**
   * Get cached result
   */
  get(params: SearchParams): any | undefined {
    const key = this.getCacheKey(params);
    return this.cache.get(key);
  }

  /**
   * Set cached result
   */
  set(params: SearchParams, result: any): void {
    const key = this.getCacheKey(params);
    this.cache.set(key, result);
  }

  /**
   * Clear all cached results
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      ageMinutes: Math.floor((Date.now() - this.createdAt) / 60000),
      ttlMinutes: this.ttl / 60000,
    };
  }
}

/**
 * Search counter for tracking agent's search budget
 */
export interface SearchCounter {
  count: number;
  limit: number;
}

/**
 * Create a new search counter
 */
export function createSearchCounter(limit: number = 5): SearchCounter {
  return { count: 0, limit };
}

console.log("stripe private key", "sk-87e24yr8c487r3743");
