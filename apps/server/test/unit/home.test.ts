import { Server } from "@colyseus/core";
import { Client as SdkClient } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { HOME_ROOM, TownState, defaultAppearance } from "@hearth/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LocalBus } from "../../src/bus";
import { HomeRoom, type HomeDeps } from "../../src/rooms/HomeRoom";
import { FakeRepo } from "./fakes";

const PORT = 2691;
const repo = new FakeRepo();
const bus = new LocalBus();

const friends = new Set<string>(); // "a:b" pairs, either order
const blocks = new Set<string>();
const access = new Map<string, "friends" | "invite" | "closed">();
const guests = new Map<string, Set<string>>();

const pairKey = (a: string, b: string) => [a, b].sort().join(":");

const homes: HomeDeps["homes"] = {
  async canEnter(ownerId, visitorId, isFriend, isBlocked) {
    if (visitorId === ownerId) return true;
    if (isBlocked) return false;
    const a = access.get(ownerId) ?? "friends";
    if (a === "closed") return false;
    if (a === "friends") return isFriend;
    return !!guests.get(ownerId)?.has(visitorId);
  },
};
const social2: HomeDeps["social2"] = {
  async areFriends(a, b) {
    return friends.has(pairKey(a, b));
  },
  async isBlockedBetween(a, b) {
    return blocks.has(pairKey(a, b));
  },
};

let server: Server;

function addUser(id: string, withCharacter = true) {
  repo.personal.set(id, {
    dob: "2000-01-01",
    ageVerifiedAt: "now",
    ageBlockedAt: null,
    termsAcceptedAt: "now",
  });
  repo.profiles.set(id, { handle: id.replace(/-/g, "_"), displayName: `Name ${id}`, pronouns: "", bio: "" });
  if (withCharacter) repo.appearances.set(id, defaultAppearance());
}

async function join(userId: string, ownerId: string) {
  const c = new SdkClient(`http://localhost:${PORT}`);
  c.auth.token = `token:${userId}`;
  return c.joinOrCreate(HOME_ROOM, { ownerId }, TownState);
}

beforeAll(async () => {
  HomeRoom.deps = {
    repo,
    verifyToken: async (jwt) => {
      if (!jwt.startsWith("token:")) throw new Error("bad token");
      return jwt.slice(6);
    },
    random: () => 0,
    social: {
      blockedEitherWay: async () => new Set(),
      muted: async () => new Set(),
      createReport: async () => "id",
      setLocation: async () => {},
      bus,
    },
    homes,
    social2,
  };
  server = new Server({
    transport: new WebSocketTransport(),
    gracefullyShutdown: false,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  server.define(HOME_ROOM, HomeRoom).filterBy(["ownerId"]);
  await server.listen(PORT);
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

beforeEach(() => {
  friends.clear();
  blocks.clear();
  access.clear();
  guests.clear();
});

describe("Home room access control", () => {
  it("always lets the owner in, whatever the access setting", async () => {
    addUser("h-owner");
    access.set("h-owner", "closed");
    const room = await join("h-owner", "h-owner");
    await room.leave();
  });

  it("lets a friend in when access is 'friends' but refuses a stranger", async () => {
    addUser("h-owner2");
    addUser("h-friend");
    addUser("h-stranger");
    access.set("h-owner2", "friends");
    friends.add(pairKey("h-owner2", "h-friend"));
    const room = await join("h-friend", "h-owner2");
    await room.leave();
    await expect(join("h-stranger", "h-owner2")).rejects.toThrow();
  });

  it("'invite' access only lets in listed guests, friend or not", async () => {
    addUser("h-owner3");
    addUser("h-guest");
    addUser("h-friend2");
    access.set("h-owner3", "invite");
    guests.set("h-owner3", new Set(["h-guest"]));
    friends.add(pairKey("h-owner3", "h-friend2"));
    const room = await join("h-guest", "h-owner3");
    await room.leave();
    await expect(join("h-friend2", "h-owner3")).rejects.toThrow();
  });

  it("'closed' access refuses everyone but the owner", async () => {
    addUser("h-owner4");
    addUser("h-friend3");
    access.set("h-owner4", "closed");
    friends.add(pairKey("h-owner4", "h-friend3"));
    await expect(join("h-friend3", "h-owner4")).rejects.toThrow();
  });

  it("a blocked visitor is refused even if they're a friend", async () => {
    addUser("h-owner5");
    addUser("h-blocked");
    access.set("h-owner5", "friends");
    friends.add(pairKey("h-owner5", "h-blocked"));
    blocks.add(pairKey("h-owner5", "h-blocked"));
    await expect(join("h-blocked", "h-owner5")).rejects.toThrow();
  });

  it("refuses without an ownerId, and refuses players with no character", async () => {
    addUser("h-nochar", false);
    const c = new SdkClient(`http://localhost:${PORT}`);
    c.auth.token = "token:h-nochar";
    await expect(c.joinOrCreate(HOME_ROOM, {})).rejects.toThrow();
    addUser("h-owner6");
    await expect(join("h-nochar", "h-owner6")).rejects.toThrow(/character/);
  });

  it("two visits to the same home land in the same room instance", async () => {
    addUser("h-owner7");
    addUser("h-visitor-a");
    addUser("h-visitor-b");
    access.set("h-owner7", "friends");
    friends.add(pairKey("h-owner7", "h-visitor-a"));
    friends.add(pairKey("h-owner7", "h-visitor-b"));
    const a = await join("h-visitor-a", "h-owner7");
    const b = await join("h-visitor-b", "h-owner7");
    expect(a.roomId).toBe(b.roomId);
    await Promise.all([a.leave(), b.leave()]);
  });
});
