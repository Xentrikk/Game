import {
  TOWN_MAX_PLAYERS,
  appearanceSchema,
  parseMap,
  type PresenceLocation,
  type TiledMap,
  type WorldMap,
} from "@hearth/shared";
import town from "@hearth/shared/maps/town.json" with { type: "json" };
import { PlayerRoom, type PlayerAuth, type PlayerRoomDeps, type WorldSocial } from "./PlayerRoom";

export type { PlayerAuth, WorldSocial };
export type WorldDeps = PlayerRoomDeps;

const townMap: WorldMap = parseMap(town as TiledMap);

/**
 * The Town Square. One instance holds up to 50 players; matchmaking opens another instance (shard)
 * when one is full.
 */
export class TownRoom extends PlayerRoom {
  /** Set once at startup (and by tests). */
  static deps: WorldDeps;

  override maxClients = TOWN_MAX_PLAYERS;

  protected get map(): WorldMap {
    return townMap;
  }

  protected get deps(): WorldDeps {
    return TownRoom.deps;
  }

  protected locationOf(): PresenceLocation {
    return { kind: "town", roomId: this.roomId };
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
}
