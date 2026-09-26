import { Room, type Client } from "@colyseus/core";
import {
  CLOSE_REPLACED,
  PATCH_MS,
  PlayerState,
  RECONNECT_SECONDS,
  TOWN_MAX_PLAYERS,
  TownState,
  appearanceSchema,
  dirIndex,
  faceMessage,
  moveMessage,
  parseMap,
  type Appearance,
  type TiledMap,
  type WorldMap,
} from "@hearth/shared";
import town from "@hearth/shared/maps/town.json" with { type: "json" };
import type { TokenVerifier } from "../auth";
import type { Repo } from "../repo";
import { applyStep, newMover, type Mover } from "./movement";

export interface WorldDeps {
  repo: Repo;
  verifyToken: TokenVerifier;
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

  override onJoin(client: Client) {
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
    this.state.players.delete(client.sessionId);
    this.movers.delete(client.sessionId);
    this.unsubscribe.get(client.sessionId)?.();
    this.unsubscribe.delete(client.sessionId);
    this.replaced.delete(client.sessionId);
  }
}
