import {
  HOME_MAX_PLAYERS,
  appearanceSchema,
  parseMap,
  type PresenceLocation,
  type TiledMap,
  type WorldMap,
} from "@hearth/shared";
import home from "@hearth/shared/maps/home.json" with { type: "json" };
import type { HomeRepo } from "../economy/homeRepo";
import type { SocialRepo } from "../social/socialRepo";
import { PlayerRoom, type PlayerAuth, type PlayerRoomDeps } from "./PlayerRoom";

const homeMap: WorldMap = parseMap(home as TiledMap);

export interface HomeDeps extends PlayerRoomDeps {
  homes: Pick<HomeRepo, "canEnter">;
  social2: Pick<SocialRepo, "areFriends" | "isBlockedBetween">;
}

/**
 * A private home. One Colyseus instance exists per home (`filterBy(["ownerId"])` in index.ts), so
 * every visitor to the same home lands in the same room. Access is checked once, at matchmaking
 * (`onAuth`, before a seat is reserved): the owner always gets in; everyone else is subject to the
 * owner's access setting (friends / invite only / closed) and their block list.
 */
export class HomeRoom extends PlayerRoom {
  /** Set once at startup (and by tests). */
  static deps: HomeDeps;

  override maxClients = HOME_MAX_PLAYERS;
  private ownerId!: string;

  override onCreate(options: { ownerId?: string } = {}) {
    if (!options.ownerId) throw new Error("HomeRoom created without an ownerId");
    this.ownerId = options.ownerId;
    super.onCreate();
  }

  protected get map(): WorldMap {
    return homeMap;
  }

  protected get deps(): HomeDeps {
    return HomeRoom.deps;
  }

  protected locationOf(): PresenceLocation {
    return { kind: "home", roomId: this.roomId, ownerId: this.ownerId };
  }

  static override async onAuth(token: string, options: { ownerId?: string }): Promise<PlayerAuth> {
    const { repo, verifyToken, homes, social2 } = HomeRoom.deps;
    if (!token) throw new Error("Please sign in.");
    const ownerId = options?.ownerId;
    if (!ownerId) throw new Error("No home specified.");
    const userId = await verifyToken(token);
    const [personal, profile, appearance] = await Promise.all([
      repo.getPersonal(userId),
      repo.getProfile(userId),
      repo.getAppearance(userId),
    ]);
    if (personal?.ageBlockedAt) throw new Error("not_eligible");
    if (!profile || !appearance) throw new Error("Finish making your character first.");
    if (userId !== ownerId) {
      const [isFriend, isBlocked] = await Promise.all([
        social2.areFriends(userId, ownerId),
        social2.isBlockedBetween(userId, ownerId),
      ]);
      if (!(await homes.canEnter(ownerId, userId, isFriend, isBlocked))) {
        throw new Error("This home isn't open to you right now.");
      }
    }
    return {
      userId,
      handle: profile.handle,
      name: profile.displayName,
      appearance: appearanceSchema.parse(appearance),
    };
  }
}
