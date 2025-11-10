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
      ...options.redisOptions,
    });
  }

  async connect(): Promise<void> {
    if (["ready", "connecting", "reconnecting"].includes(this.client.status)) {
      return;
    }
    try {
      await this.client.connect();
    } catch (error) {
      console.error("Failed to connect to Redis:", error);
      throw error;
    }
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
    try {
      if (isValid(value)) {
        return JSON.parse(value) as T;
      } else {
        throw new Error("Invalid data");
      }
    } catch (error) {
      console.error("Failed to parse JSON:", error);
      return undefined;
    }
  }

  async set(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.options.defaultTtlSeconds;
    const encodedValue = msgpack.encode(value); // Using MessagePack or similar library
    await this.client.set(key, encodedValue, "EX", ttl);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
