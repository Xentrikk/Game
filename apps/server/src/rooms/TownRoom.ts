import { Room, type Client } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  CLOSE_REPLACED,
  SAY_RANGE_TILES,
  emoteMessage,
  maskProfanity,
  reportSayMessage,
  sayMessage,
  type ReportReason,
  PATCH_MS,
  PlayerState,
  RECONNECT_SECONDS,
  TOWN_MAX_PLAYERS,
  TownState,
  appearanceSchema,
  applyStep,
  dirIndex,
  faceMessage,
  moveMessage,
  newMover,
  parseMap,
  type Appearance,
  type Mover,
  type TiledMap,
  type WorldMap,
} from "@hearth/shared";
import town from "@hearth/shared/maps/town.json" with { type: "json" };
import type { TokenVerifier } from "../auth";
import { BLOCKS_CHANNEL, type EventBus } from "../bus";
import type { Repo } from "../repo";

/** The social features the world needs (friends, blocks, mutes, reports, presence). */
export interface WorldSocial {
  blockedEitherWay(userId: string): Promise<Set<string>>;
  muted(userId: string): Promise<Set<string>>;
  createReport(r: {
    reporter: string;
    targetUser: string;
    kind: "say";
    reason: ReportReason;
    note: string;
    context: unknown;
  }): Promise<string>;
  setLocation(userId: string, location: { roomId: string } | null): Promise<void>;
  bus: EventBus;
}

export interface WorldDeps {
  repo: Repo;
  verifyToken: TokenVerifier;
  social?: WorldSocial;
  now?: () => number;
  /** Picks the spawn point; injectable for tests. */
  random?: () => number;
}

export interface PlayerAuth {
  userId: string;
  handle: string;
  name: string;
  appearance: Appearance;
}

const townMap: WorldMap = parseMap(town as TiledMap);

type BlockEvent =
  | { blocker: string; blocked: string }
  | { unblocker: string; unblocked: string }
  | { muter: string; muted: string }
  | { unmuter: string; unmuted: string };

/**
 * The Town Square. One instance holds up to 50 players; matchmaking opens another instance (shard)
 * when one is full. The server owns every position: clients send step intents, never coordinates.
 */
export class TownRoom extends Room {
  /** Set once at startup (and by tests). */
  static deps: WorldDeps;

  override maxClients = TOWN_MAX_PLAYERS;
  /** Walking + turning is at most ~10 messages/s; anything far above that is abuse. */
  override maxMessagesPerSecond = 30;
  override state = new TownState();

  private map = townMap;
  private movers = new Map<string, Mover>();
  private unsubscribe = new Map<string, () => void>();
  /** Sessions replaced by a newer login; they must not reconnect. */
  private replaced = new Set<string>();
  /** Per session: everyone they've blocked or been blocked by, and everyone they've muted (user ids). */
  private blocked = new Map<string, Set<string>>();
  private mutedBy = new Map<string, Set<string>>();
  /** Recent Say lines, attached to Say reports so moderators see the conversation. */
  private sayLog: { at: string; userId: string; handle: string; text: string }[] = [];
  private sayTimes = new Map<string, number[]>();
  private lastEmote = new Map<string, number>();
  private offBlocks?: () => void;
  private now = () => (TownRoom.deps.now ?? Date.now)();

  override onCreate() {
    this.patchRate = PATCH_MS;

    this.onMessage("move", (client, raw) => {
      const msg = moveMessage.safeParse(raw);
      const player = this.state.players.get(client.sessionId);
      const mover = this.movers.get(client.sessionId);
      if (!msg.success || !player || !mover || msg.data.seq <= player.seq) return;
      const result = applyStep(this.map, mover, msg.data.dir, msg.data.run, this.now());
      // Always acknowledge the seq, so a client whose step was refused snaps back to the server's position.
      player.seq = msg.data.seq;
      player.dir = dirIndex(msg.data.dir);
      if (result.ok) {
        player.x = result.x;
        player.y = result.y;
        player.run = msg.data.run;
      }
    });

    this.onMessage("face", (client, raw) => {
      const msg = faceMessage.safeParse(raw);
      const player = this.state.players.get(client.sessionId);
      if (msg.success && player) player.dir = dirIndex(msg.data.dir);
    });

    this.onMessage("say", (client, raw) => {
      const msg = sayMessage.safeParse(raw);
      const speaker = this.state.players.get(client.sessionId);
      if (!msg.success || !speaker || !this.allowSay(client.sessionId)) return;
      const text = maskProfanity(msg.data.text);
      const auth = client.auth as PlayerAuth;
      this.sayLog.push({
        at: new Date(this.now()).toISOString(),
        userId: auth.userId,
        handle: auth.handle,
        text,
      });
      if (this.sayLog.length > 50) this.sayLog.shift();
      for (const other of this.clients) {
        const p = this.state.players.get(other.sessionId);
        if (!p || !this.canHear(other, client)) continue;
        if (Math.max(Math.abs(p.x - speaker.x), Math.abs(p.y - speaker.y)) > SAY_RANGE_TILES) continue;
        other.send("say", { sessionId: client.sessionId, text });
      }
    });

    this.onMessage("emote", (client, raw) => {
      const msg = emoteMessage.safeParse(raw);
      if (!msg.success || !this.state.players.has(client.sessionId)) return;
      const last = this.lastEmote.get(client.sessionId) ?? 0;
      if (this.now() - last < 1000) return;
      this.lastEmote.set(client.sessionId, this.now());
      for (const other of this.clients) {
        if (this.canHear(other, client))
          other.send("emote", { sessionId: client.sessionId, emote: msg.data.emote });
      }
    });

    this.onMessage("report_say", async (client, raw) => {
      const msg = reportSayMessage.safeParse(raw);
      const social = TownRoom.deps.social;
      const target = this.clients.find((c) => c.sessionId === (msg.success ? msg.data.sessionId : ""));
      if (!msg.success || !social || !target) return;
      const reporter = client.auth as PlayerAuth;
      const reported = target.auth as PlayerAuth;
      await social.createReport({
        reporter: reporter.userId,
        targetUser: reported.userId,
        kind: "say",
        reason: msg.data.reason,
        note: msg.data.note,
        context: { roomId: this.roomId, lines: [...this.sayLog] },
      });
      client.send("reported", { sessionId: msg.data.sessionId });
    });

    // Blocks and mutes made elsewhere (e.g. from a profile card) take effect here at once.
    this.offBlocks = TownRoom.deps.social?.bus.subscribe(BLOCKS_CHANNEL, (raw) =>
      this.onBlockEvent(raw as BlockEvent),
    );
  }

  override onDispose() {
    this.offBlocks?.();
  }

  /** Five Say lines per ten seconds per player. */
  private allowSay(sessionId: string): boolean {
    const now = this.now();
    const recent = (this.sayTimes.get(sessionId) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 5) return false;
    recent.push(now);
    this.sayTimes.set(sessionId, recent);
    return true;
  }

  private userOf(client: Client) {
    return (client.auth as PlayerAuth).userId;
  }

  private canSee(a: Client, b: Client): boolean {
    return (
      !this.blocked.get(a.sessionId)?.has(this.userOf(b)) &&
      !this.blocked.get(b.sessionId)?.has(this.userOf(a))
    );
  }

  /** Whether `listener` receives `speaker`'s Say and emotes (visible and not muted). */
  private canHear(listener: Client, speaker: Client): boolean {
    return this.canSee(listener, speaker) && !this.mutedBy.get(listener.sessionId)?.has(this.userOf(speaker));
  }

  /** Shows or hides two players to each other, per their block status. */
  private syncVisibility(a: Client, b: Client) {
    const pa = this.state.players.get(a.sessionId);
    const pb = this.state.players.get(b.sessionId);
    if (!pa || !pb || !a.view || !b.view) return;
    if (this.canSee(a, b)) {
      a.view.add(pb);
      b.view.add(pa);
    } else {
      a.view.remove(pb);
      b.view.remove(pa);
    }
  }

  private onBlockEvent(e: BlockEvent) {
    const sessionsOf = (userId: string) => this.clients.filter((c) => this.userOf(c) === userId);
    const pairs: [string, string, "block" | "unblock" | "mute" | "unmute"][] = [];
    if ("blocker" in e) pairs.push([e.blocker, e.blocked, "block"]);
    if ("unblocker" in e) pairs.push([e.unblocker, e.unblocked, "unblock"]);
    if ("muter" in e) pairs.push([e.muter, e.muted, "mute"]);
    if ("unmuter" in e) pairs.push([e.unmuter, e.unmuted, "unmute"]);
    for (const [actor, target, kind] of pairs) {
      for (const a of sessionsOf(actor)) {
        if (kind === "mute") this.mutedBy.get(a.sessionId)?.add(target);
        if (kind === "unmute") this.mutedBy.get(a.sessionId)?.delete(target);
        if (kind === "block") this.blocked.get(a.sessionId)?.add(target);
        if (kind === "unblock") this.blocked.get(a.sessionId)?.delete(target);
      }
      for (const b of sessionsOf(target)) {
        if (kind === "block") this.blocked.get(b.sessionId)?.add(actor);
        if (kind === "unblock") this.blocked.get(b.sessionId)?.delete(actor);
      }
      if (kind === "block" || kind === "unblock") {
        for (const a of sessionsOf(actor)) for (const b of sessionsOf(target)) this.syncVisibility(a, b);
      }
    }
  }

  /**
   * Runs at matchmaking (HTTP), before a seat is reserved, so unauthenticated requests or players
   * without a character never take a seat. The result becomes `client.auth`.
   */
  static override async onAuth(token: string): Promise<PlayerAuth> {
    const { repo, verifyToken } = TownRoom.deps;
    if (!token) throw new Error("Please sign in.");
    const userId = await verifyToken(token);
    const [personal, profile, appearance] = await Promise.all([
      repo.getPersonal(userId),
      repo.getProfile(userId),
      repo.getAppearance(userId),
    ]);
    if (personal?.ageBlockedAt) throw new Error("not_eligible");
    if (!profile || !appearance) throw new Error("Finish making your character first.");
    return {
      userId,
      handle: profile.handle,
      name: profile.displayName,
      appearance: appearanceSchema.parse(appearance),
    };
  }

  override async onJoin(client: Client) {
    const auth = client.auth as PlayerAuth;
    const random = TownRoom.deps.random ?? Math.random;
    const spawn = this.map.spawns[Math.floor(random() * this.map.spawns.length)]!;
    const player = new PlayerState();
    player.handle = auth.handle;
    player.name = auth.name;
    player.appearance = JSON.stringify(auth.appearance);
    player.x = spawn.x;
    player.y = spawn.y;
    player.dir = dirIndex("down");
    // Schema fields start undefined; clients count their move seqs up from here.
    player.run = false;
    player.seq = 0;
    player.connected = true;
    this.state.players.set(client.sessionId, player);
    this.movers.set(client.sessionId, newMover(spawn.x, spawn.y, this.now()));

    // Each client only receives the players it may see.
    const social = TownRoom.deps.social;
    this.blocked.set(client.sessionId, social ? await social.blockedEitherWay(auth.userId) : new Set());
    this.mutedBy.set(client.sessionId, social ? await social.muted(auth.userId) : new Set());
    client.view = new StateView();
    client.view.add(player);
    for (const other of this.clients) if (other !== client) this.syncVisibility(client, other);
    void social?.setLocation(auth.userId, { roomId: this.roomId });

    // One presence per account, across every shard: joining again replaces the older session.
    const channel = `user:${auth.userId}`;
    this.presence.publish(channel, client.sessionId);
    const onOtherSession = (sessionId: string) => {
      if (sessionId === client.sessionId) return;
      this.replaced.add(client.sessionId);
      client.leave(CLOSE_REPLACED, "You joined from somewhere else.");
    };
    this.presence.subscribe(channel, onOtherSession);
    this.unsubscribe.set(client.sessionId, () => this.presence.unsubscribe(channel, onOtherSession));
  }

  override async onDrop(client: Client) {
    if (this.replaced.has(client.sessionId)) return;
    // Keep the player in the world (same spot, shown faded) while their client reconnects.
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  override onLeave(client: Client) {
    const auth = client.auth as PlayerAuth;
    // Only clear the location if they haven't already moved to another instance.
    const stillHere = this.clients.some((c) => c !== client && this.userOf(c) === auth.userId);
    if (!stillHere && !this.replaced.has(client.sessionId))
      void TownRoom.deps.social?.setLocation(auth.userId, null);
    this.blocked.delete(client.sessionId);
    this.mutedBy.delete(client.sessionId);
    this.sayTimes.delete(client.sessionId);
    this.lastEmote.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.movers.delete(client.sessionId);
    this.unsubscribe.get(client.sessionId)?.();
    this.unsubscribe.delete(client.sessionId);
    this.replaced.delete(client.sessionId);
  }
}
