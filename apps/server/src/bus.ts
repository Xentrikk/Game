import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";

/**
 * Pub/sub for live events (new messages, presence, blocks). In-memory for a single server; Redis when
 * several servers run, so an event published on one reaches a user connected to another.
 */
export interface EventBus {
  publish(channel: string, event: unknown): void;
  subscribe(channel: string, handler: (event: unknown) => void): () => void;
}

export class LocalBus implements EventBus {
  private emitter = new EventEmitter().setMaxListeners(0);

  publish(channel: string, event: unknown) {
    this.emitter.emit(channel, event);
  }

  subscribe(channel: string, handler: (event: unknown) => void) {
    this.emitter.on(channel, handler);
    return () => void this.emitter.off(channel, handler);
  }
}

export class RedisBus implements EventBus {
  private local = new LocalBus();
  private counts = new Map<string, number>();

  constructor(
    private pub: Redis,
    private sub: Redis,
  ) {
    sub.on("message", (channel: string, raw: string) => this.local.publish(channel, JSON.parse(raw)));
  }

  publish(channel: string, event: unknown) {
    void this.pub.publish(channel, JSON.stringify(event));
  }

  subscribe(channel: string, handler: (event: unknown) => void) {
    const n = (this.counts.get(channel) ?? 0) + 1;
    this.counts.set(channel, n);
    if (n === 1) void this.sub.subscribe(channel);
    const off = this.local.subscribe(channel, handler);
    return () => {
      off();
      const left = (this.counts.get(channel) ?? 1) - 1;
      this.counts.set(channel, left);
      if (left === 0) void this.sub.unsubscribe(channel);
    };
  }
}

/** Channel with everything addressed to one user. */
export const userChannel = (userId: string) => `user:${userId}`;
/** Channel the world rooms listen on for new blocks, so blocked players vanish at once. */
export const BLOCKS_CHANNEL = "world:blocks";
