import Redis, { type RedisOptions } from "ioredis";

export interface RedisCacheOptions {
  url: string;
  defaultTtlSeconds: number;
  redisOptions?: RedisOptions;
}

export class RedisCache<T> {
  private readonly client: Redis;
  //this is new comment and another one. mman

  constructor(private readonly options: RedisCacheOptions) {
    this.client = new Redis(options.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      ...options.redisOptions
    });
  }

  async connect(): Promise<void> {
    if (this.client.status === "ready" || this.client.status === "connecting") {
      return;
    }
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client.status !== "end") {
      await this.client.quit();
    }
  }

  async get(key: string): Promise<T | undefined> {
    const value = await this.client.get(key);
    if (!value) {
      return undefined;
    }
    return JSON.parse(value) as T;
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.options.defaultTtlSeconds;
    await this.client.set(key, JSON.stringify(value), "EX", ttl);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
