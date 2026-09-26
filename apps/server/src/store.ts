import { Redis } from "ioredis";

/**
 * Small key-value store with expiry, used for rate limits and OTP attempt tracking.
 * Redis in production (shared across server instances); in-memory for tests and local dev.
 */
export interface Store {
  /** Increments a counter that expires `windowSec` after its first increment. Returns the new count and seconds left. */
  incr(key: string, windowSec: number): Promise<{ count: number; ttlSec: number }>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryStore implements Store {
  private data = new Map<string, { value: string; expiresAt: number }>();
  constructor(private now: () => number = Date.now) {}

  private live(key: string) {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  async incr(key: string, windowSec: number) {
    const entry = this.live(key);
    if (!entry) {
      this.data.set(key, { value: "1", expiresAt: this.now() + windowSec * 1000 });
      return { count: 1, ttlSec: windowSec };
    }
    entry.value = String(Number(entry.value) + 1);
    return { count: Number(entry.value), ttlSec: Math.ceil((entry.expiresAt - this.now()) / 1000) };
  }

  async getJson<T>(key: string) {
    const entry = this.live(key);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSec: number) {
    this.data.set(key, { value: JSON.stringify(value), expiresAt: this.now() + ttlSec * 1000 });
  }

  async del(key: string) {
    this.data.delete(key);
  }
}

export class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async incr(key: string, windowSec: number) {
    const [[, count], [, ttl]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, windowSec, "NX")
      .ttl(key)
      .exec()) as [[null, number], [null, number], [null, number]];
    return { count, ttlSec: ttl };
  }

  async getJson<T>(key: string) {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSec: number) {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSec);
  }

  async del(key: string) {
    await this.redis.del(key);
  }
}
