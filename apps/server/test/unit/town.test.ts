import { Server, matchMaker } from "@colyseus/core";
import { Client as SdkClient, type Room } from "@colyseus/sdk";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  CLOSE_REPLACED,
  TOWN_MAX_PLAYERS,
  TOWN_ROOM,
  TownState,
  defaultAppearance,
  parseMap,
  type TiledMap,
} from "@hearth/shared";
import town from "@hearth/shared/maps/town.json" with { type: "json" };
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLOCKS_CHANNEL, LocalBus } from "../../src/bus";
import { TownRoom, type WorldSocial } from "../../src/rooms/TownRoom";
import { FakeRepo } from "./fakes";

const PORT = 2690;
const map = parseMap(town as TiledMap);
const repo = new FakeRepo();
const bus = new LocalBus();
const blocks: [string, string][] = [];
const mutes: [string, string][] = [];
const reports: Parameters<WorldSocial["createReport"]>[0][] = [];
const locations = new Map<string, string | null>();
const social: WorldSocial = {
  async blockedEitherWay(id) {
    return new Set(blocks.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])));
  },
  async muted(id) {
    return new Set(mutes.filter(([a]) => a === id).map(([, b]) => b));
  },
  async createReport(r) {
    reports.push(r);
    return "report-id";
  },
  async setLocation(id, loc) {
    locations.set(id, loc?.roomId ?? null);
  },
  bus,
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

type TownRoomClient = Room<unknown, TownState>;

async function join(userId: string): Promise<TownRoomClient> {
  const c = new SdkClient(`http://localhost:${PORT}`);
  c.auth.token = `token:${userId}`;
  const room = (await c.joinOrCreate(TOWN_ROOM, {}, TownState)) as TownRoomClient;
  room.reconnection.minUptime = 0;
  await until(() => room.state?.players?.get(room.sessionId));
  return room;
}

async function until<T>(fn: () => T, ms = 3000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const me = (room: TownRoomClient) => room.state.players.get(room.sessionId)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  TownRoom.deps = {
    repo,
    verifyToken: async (jwt) => {
      if (!jwt.startsWith("token:")) throw new Error("bad token");
      return jwt.slice(6);
    },
    random: () => 0, // always the first spawn point
    social,
  };
  server = new Server({
    transport: new WebSocketTransport(),
    gracefullyShutdown: false,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  server.define(TOWN_ROOM, TownRoom);
  await server.listen(PORT);
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

describe("Town Square room", () => {
  it("spawns a player with their handle, name and appearance", async () => {
    addUser("u-spawn");
    const room = await join("u-spawn");
    const p = me(room);
    expect({ x: p.x, y: p.y }).toEqual(map.spawns[0]);
    expect(p.handle).toBe("u_spawn");
    expect(p.name).toBe("Name u-spawn");
    expect(JSON.parse(p.appearance)).toEqual(defaultAppearance());
    // Clients number their moves from the starting seq, so it must be a real number.
    expect(p.seq).toBe(0);
    expect(p.run).toBe(false);
    expect(p.connected).toBe(true);
    await room.leave();
  });

  it("won't reserve a seat at matchmaking without a valid token", async () => {
    for (const headers of [{}, { authorization: "Bearer forged" }] as Record<string, string>[]) {
      const res = await fetch(`http://localhost:${PORT}/matchmake/joinOrCreate/${TOWN_ROOM}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{}",
      });
      expect(res.ok).toBe(false);
      expect(await res.text()).not.toContain("sessionId");
    }
  });

  it("refuses players who aren't signed in or have no character", async () => {
    addUser("u-nochar", false);
    const c = new SdkClient(`http://localhost:${PORT}`);
    await expect(c.joinOrCreate(TOWN_ROOM)).rejects.toThrow();
    c.auth.token = "forged";
    await expect(c.joinOrCreate(TOWN_ROOM)).rejects.toThrow();
    c.auth.token = "token:u-nochar";
    await expect(c.joinOrCreate(TOWN_ROOM)).rejects.toThrow(/character/);
  });

  it("moves on legal steps and acknowledges every step", async () => {
    addUser("u-walk");
    const room = await join("u-walk");
    const start = { ...map.spawns[0]! };
    room.send("move", { dir: "right", run: false, seq: 1 });
    await until(() => me(room).seq === 1);
    expect([me(room).x, me(room).y]).toEqual([start.x + 1, start.y]);
    expect(me(room).dir).toBe(2); // right
    await room.leave();
  });

  it("refuses steps into walls but still acknowledges them", async () => {
    addUser("u-wall");
    const room = await join("u-wall");
    // Walk up from (19,17) towards the fountain at y 13–14.
    let seq = 0;
    for (const dir of ["right", "up", "up"] as const) {
      room.send("move", { dir, run: false, seq: ++seq });
      await sleep(260);
    }
    await until(() => me(room).seq === 3);
    expect([me(room).x, me(room).y]).toEqual([19, 15]);
    room.send("move", { dir: "up", run: false, seq: ++seq });
    await until(() => me(room).seq === 4);
    expect([me(room).x, me(room).y]).toEqual([19, 15]);
    await room.leave();
  });

  it("rejects speed hacks: a burst of steps only moves as far as the bucket allows", async () => {
    addUser("u-fast");
    const room = await join("u-fast");
    const start = map.spawns[0]!;
    for (let seq = 1; seq <= 10; seq++) room.send("move", { dir: "down", run: true, seq });
    await until(() => me(room).seq === 10);
    // Capacity is 3 walk-steps worth of time = 6 run steps; the burst gets no further than that.
    expect(me(room).y - start.y).toBeLessThanOrEqual(6);
    expect(me(room).y - start.y).toBeGreaterThan(0);
    await room.leave();
  });

  it("ignores malformed and replayed messages", async () => {
    addUser("u-junk");
    const room = await join("u-junk");
    const start = { x: me(room).x, y: me(room).y };
    room.send("move", { dir: "north", run: false, seq: 1 });
    room.send("move", { dir: "right", run: false, seq: "2" });
    room.send("move", { dir: "right", run: false, seq: 1, x: 99 });
    room.send("move", { dir: "right", run: false, seq: 5 });
    await until(() => me(room).seq === 5);
    room.send("move", { dir: "right", run: false, seq: 5 }); // replay
    await sleep(200);
    expect([me(room).x, me(room).y]).toEqual([start.x + 1, start.y]);
    await room.leave();
  });

  it("disconnects clients that send message types the room doesn't know", async () => {
    addUser("u-teleport");
    const room = await join("u-teleport");
    room.reconnection.enabled = false;
    const left = new Promise<number>((r) => room.onLeave((code) => r(code)));
    room.send("teleport", { x: 1, y: 1 });
    expect(await left).toBeGreaterThanOrEqual(4000);
  });

  it("keeps a dropped player in place and restores them on reconnect", async () => {
    addUser("u-drop");
    const room = await join("u-drop");
    room.send("move", { dir: "right", run: false, seq: 1 });
    await until(() => me(room).seq === 1);
    const before = { x: me(room).x, y: me(room).y, sessionId: room.sessionId };
    addUser("u-watch");
    const watcher = await join("u-watch");
    const seenConnected = () => watcher.state.players.get(before.sessionId)?.connected;
    const reconnected = new Promise<void>((r) => room.onReconnect(() => r()));
    // Simulate a network drop: close the socket without leaving.
    (room.connection as unknown as { transport: { ws: WebSocket } }).transport.ws.close();
    await until(() => seenConnected() === false);
    await reconnected;
    await until(() => seenConnected() === true);
    await watcher.leave();
    expect(room.sessionId).toBe(before.sessionId);
    expect({ x: me(room).x, y: me(room).y }).toEqual({ x: before.x, y: before.y });
    // And it can keep walking with the next seq.
    room.send("move", { dir: "right", run: false, seq: 2 });
    await until(() => me(room).seq === 2);
    expect(me(room).x).toBe(before.x + 1);
    await room.leave();
  });

  it("allows one presence per account: joining again replaces the old session", async () => {
    addUser("u-twice");
    const first = await join("u-twice");
    const closed = new Promise<number>((r) => first.onLeave((code) => r(code)));
    const second = await join("u-twice");
    expect(await closed).toBe(CLOSE_REPLACED);
    await until(() => second.state.players.size > 0 && !second.state.players.get(first.sessionId));
    const handles = [...second.state.players.values()].map((p: { handle: string }) => p.handle);
    expect(handles.filter((h) => h === "u_twice")).toHaveLength(1);
    await second.leave();
  });

  it(`opens a new instance when one has ${TOWN_MAX_PLAYERS} players`, async () => {
    const rooms: TownRoomClient[] = [];
    for (let i = 0; i < TOWN_MAX_PLAYERS + 1; i++) {
      addUser(`u-crowd-${i}`);
      rooms.push(await join(`u-crowd-${i}`));
    }
    // Earlier tests may leave players in their reconnection window, so check the server's real occupancy.
    const instances = await matchMaker.query({ name: TOWN_ROOM });
    expect(instances.length).toBeGreaterThanOrEqual(2);
    for (const r of instances) expect(r.clients).toBeLessThanOrEqual(TOWN_MAX_PLAYERS);
    expect(instances.some((r) => r.clients === TOWN_MAX_PLAYERS)).toBe(true);
    expect(new Set(rooms.map((r) => r.roomId)).size).toBeGreaterThanOrEqual(2);
    await Promise.all(rooms.map((r) => r.leave()));
  }, 30000);
});

describe("talking in the world", () => {
  /** Collects messages of one type that a client receives. */
  function inbox<T>(room: TownRoomClient, type: string): T[] {
    const got: T[] = [];
    room.onMessage(type, (m: T) => got.push(m));
    return got;
  }

  async function walk(room: TownRoomClient, dir: "down" | "up" | "left" | "right", steps: number) {
    let seq = me(room).seq;
    for (let i = 0; i < steps; i++) {
      room.send("move", { dir, run: false, seq: ++seq });
      await sleep(260);
    }
    await until(() => me(room).seq === seq);
  }

  it("Say reaches players within 6 tiles, masks profanity and is rate-limited", async () => {
    addUser("t-near");
    addUser("t-far");
    addUser("t-talk");
    const talker = await join("t-talk");
    const near = await join("t-near");
    const far = await join("t-far");
    await walk(far, "down", 7); // (18,16) → (18,23): 7 tiles away
    const nearHeard = inbox<{ sessionId: string; text: string }>(near, "say");
    const farHeard = inbox<{ sessionId: string; text: string }>(far, "say");
    const selfHeard = inbox<{ text: string }>(talker, "say");
    talker.send("say", { text: "hello, this shit is fun" });
    await until(() => nearHeard.length === 1);
    expect(nearHeard[0]).toEqual({ sessionId: talker.sessionId, text: "hello, this **** is fun" });
    expect(selfHeard).toHaveLength(1);
    await sleep(150);
    expect(farHeard).toEqual([]);

    for (let i = 0; i < 6; i++) talker.send("say", { text: `line ${i}` });
    await sleep(300);
    expect(nearHeard).toHaveLength(5); // 1 + 4 more; the 6th and 7th were over the limit
    await Promise.all([talker, near, far].map((r) => r.leave()));
  });

  it("emotes reach everyone who can see you, except people who muted you", async () => {
    addUser("e-a");
    addUser("e-b");
    addUser("e-c");
    const a = await join("e-a");
    const b = await join("e-b");
    const c = await join("e-c");
    mutes.push(["e-c", "e-a"]);
    bus.publish(BLOCKS_CHANNEL, { muter: "e-c", muted: "e-a" });
    const bSaw = inbox<{ emote: string }>(b, "emote");
    const cSaw = inbox<{ emote: string }>(c, "emote");
    a.send("emote", { emote: "wave" });
    a.send("emote", { emote: "heart" }); // within a second: dropped
    a.send("emote", { emote: "dance" }); // not an emote
    await until(() => bSaw.length === 1);
    await sleep(150);
    expect(bSaw).toEqual([{ sessionId: a.sessionId, emote: "wave" }]);
    expect(cSaw).toEqual([]);
    await Promise.all([a, b, c].map((r) => r.leave()));
  });

  it("blocked players vanish for each other, live, and come back when unblocked", async () => {
    addUser("b-a");
    addUser("b-b");
    const a = await join("b-a");
    const b = await join("b-b");
    await until(() => a.state.players.get(b.sessionId) && b.state.players.get(a.sessionId));

    blocks.push(["b-a", "b-b"]);
    bus.publish(BLOCKS_CHANNEL, { blocker: "b-a", blocked: "b-b" });
    await until(() => !a.state.players.get(b.sessionId) && !b.state.players.get(a.sessionId));
    // Say and emotes don't cross a block either.
    const bHeard = inbox<unknown>(b, "say");
    a.send("say", { text: "can you hear me?" });
    await sleep(200);
    expect(bHeard).toEqual([]);

    // Someone who joins while blocked never appears.
    addUser("b-c");
    blocks.push(["b-c", "b-a"]);
    const c = await join("b-c");
    await sleep(150);
    expect(c.state.players.get(a.sessionId)).toBeUndefined();
    expect(a.state.players.get(c.sessionId)).toBeUndefined();
    expect(c.state.players.get(b.sessionId)).toBeTruthy();

    blocks.splice(
      blocks.findIndex(([x, y]) => x === "b-a" && y === "b-b"),
      1,
    );
    bus.publish(BLOCKS_CHANNEL, { unblocker: "b-a", unblocked: "b-b" });
    await until(() => a.state.players.get(b.sessionId) && b.state.players.get(a.sessionId));
    await Promise.all([a, b, c].map((r) => r.leave()));
  });

  it("reports a Say line with the recent conversation attached", async () => {
    addUser("r-a");
    addUser("r-b");
    const a = await join("r-a");
    const b = await join("r-b");
    b.send("say", { text: "you're the worst" });
    await sleep(100);
    const done = new Promise((r) => a.onMessage("reported", r));
    a.send("report_say", { sessionId: b.sessionId, reason: "harassment" });
    await done;
    const report = reports.at(-1)!;
    expect(report).toMatchObject({ reporter: "r-a", targetUser: "r-b", kind: "say", reason: "harassment" });
    const lines = (report.context as { lines: { handle: string; text: string }[] }).lines;
    expect(lines.at(-1)).toMatchObject({ handle: "r_b", text: "you're the worst" });
    await Promise.all([a, b].map((r) => r.leave()));
  });

  it("records where you are for your friends, and clears it when you leave", async () => {
    addUser("l-a");
    const a = await join("l-a");
    await until(() => locations.get("l-a") === a.roomId);
    await a.leave();
    await until(() => locations.get("l-a") === null);
  });
});
