import { HttpError } from "./errors";
import type { Store } from "./store";

/** Throws 429 once `key` has been hit more than `max` times in `windowSec`. */
export async function rateLimit(store: Store, key: string, max: number, windowSec: number, message: string) {
  const { count, ttlSec } = await store.incr(`rl:${key}`, windowSec);
  if (count > max) throw new HttpError(429, "rate_limited", message, { retryAfterSec: Math.max(ttlSec, 1) });
}
