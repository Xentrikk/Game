import type { Presence, Settings } from "@hearth/shared";
import { userChannel, type EventBus } from "../bus";
import type { Store } from "../store";
import type { SocialRepo } from "./socialRepo";

/** Seconds a presence record lives without a heartbeat (the event stream heartbeats every 30 s). */
const TTL_SEC = 120;

interface PresenceRecord {
  /** Open event streams (app tabs/devices) for this user. */
  conns: number;
  away: boolean;
  location: { roomId: string } | null;
}

const EMPTY: PresenceRecord = { conns: 0, away: false, location: null };

/** What friends see, given the raw record and the user's own settings. */
export function visiblePresence(r: PresenceRecord, s: Settings): Presence {
  const online = r.conns > 0 || !!r.location;
  if (!online || s.presence === "invisible") return { status: "offline", location: null };
  const location =
    s.shareLocation && r.location ? { kind: "town" as const, roomId: r.location.roomId } : null;
  if (s.presence === "dnd") return { status: "dnd", location };
  return { status: r.away ? "away" : "online", location };
}

/**
 * Tracks who is online, away and where, and tells their friends when that changes.
 * Records live in the shared store (Redis in production) so every server instance agrees.
 */
export class PresenceService {
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private store: Store,
    private bus: EventBus,
    private social: SocialRepo,
  ) {}

  private key = (userId: string) => `presence:${userId}`;

  async record(userId: string): Promise<PresenceRecord> {
    return (await this.store.getJson<PresenceRecord>(this.key(userId))) ?? { ...EMPTY };
  }

  /** Is the user connected right now (used to decide whether to send a push)? */
  async isConnected(userId: string): Promise<boolean> {
    return (await this.record(userId)).conns > 0;
  }

  async presenceOf(userId: string, settings?: Settings): Promise<Presence> {
    return visiblePresence(await this.record(userId), settings ?? (await this.social.settings(userId)));
  }

  /** Serializes updates per user within this process, then tells friends if what they see changed. */
  private update(userId: string, change: (r: PresenceRecord) => void): Promise<void> {
    const run = async () => {
      const settings = await this.social.settings(userId);
      const before = await this.record(userId);
      const after = { ...before, location: before.location ? { ...before.location } : null };
      change(after);
      after.conns = Math.max(0, after.conns);
      await this.store.setJson(this.key(userId), after, TTL_SEC);
      const a = visiblePresence(before, settings);
      const b = visiblePresence(after, settings);
      if (JSON.stringify(a) !== JSON.stringify(b)) await this.broadcast(userId, b);
    };
    const next = (this.queues.get(userId) ?? Promise.resolve()).then(run, run);
    this.queues.set(userId, next);
    void next.finally(() => this.queues.get(userId) === next && this.queues.delete(userId));
    return next;
  }

  /** Sends the user's current presence to each friend. */
  async broadcast(userId: string, presence?: Presence) {
    const p = presence ?? (await this.presenceOf(userId));
    for (const friend of await this.social.friendIds(userId)) {
      this.bus.publish(userChannel(friend), { type: "presence", userId, presence: p });
    }
  }

  /** An event stream opened. Returns a function to call when it closes. */
  async connect(userId: string): Promise<() => Promise<void>> {
    await this.update(userId, (r) => {
      r.conns += 1;
      r.away = false;
    });
    return () => this.update(userId, (r) => void (r.conns -= 1));
  }

  async heartbeat(userId: string) {
    await this.update(userId, () => undefined);
  }

  setAway(userId: string, away: boolean) {
    return this.update(userId, (r) => void (r.away = away));
  }

  setLocation(userId: string, location: { roomId: string } | null) {
    return this.update(userId, (r) => void (r.location = location));
  }
}
