import {
  GROUP_MAX_MEMBERS,
  settingsSchema,
  type ChatMessage,
  type ConversationSummary,
  type ServerEvent,
} from "@hearth/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChatError } from "../../src/chat/chatRepo";
import { inQuietHours } from "../../src/social/push";
import {
  deleteTestUsers,
  listen,
  makeLocalApp,
  makeSocial,
  makeUser,
  openEvents,
  userClient,
  type TestUser,
} from "./local";

const deps = makeSocial();
const app = makeLocalApp(deps);
let server: Awaited<ReturnType<typeof listen>>;
const run = Date.now().toString(36).slice(-4);
const handle = (name: string) => `c${run}_${name}`;
const uuid = () => crypto.randomUUID();

async function friends(a: TestUser, b: TestUser) {
  await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle }).expect(200);
  await request(app).post("/api/friends/requests").set(b.auth).send({ handle: a.handle }).expect(200);
}

async function dmBetween(a: TestUser, b: TestUser): Promise<ConversationSummary> {
  return (await request(app).post("/api/conversations/dm").set(a.auth).send({ userId: b.id }).expect(200))
    .body;
}

async function send(u: TestUser, conversationId: string, body: string, id = uuid()): Promise<ChatMessage> {
  const res = await request(app)
    .post(`/api/conversations/${conversationId}/messages`)
    .set(u.auth)
    .send({ id, body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.message;
}

async function list(u: TestUser): Promise<ConversationSummary[]> {
  return (await request(app).get("/api/conversations").set(u.auth)).body.conversations;
}

beforeAll(async () => {
  await deleteTestUsers();
  server = await listen(app);
});
afterAll(async () => {
  await server.close();
  await deps.sql.end();
});

describe("direct messages", () => {
  it("are only between friends, and a pair has exactly one DM", async () => {
    const a = await makeUser(server.url, handle("a1"));
    const b = await makeUser(server.url, handle("b1"));
    expect((await request(app).post("/api/conversations/dm").set(a.auth).send({ userId: b.id })).status).toBe(
      403,
    );
    await friends(a, b);
    const one = await dmBetween(a, b);
    const two = await dmBetween(b, a);
    expect(two.id).toBe(one.id);
    expect(one.kind).toBe("dm");
    expect(one.members.map((m) => m.profile.handle).sort()).toEqual([a.handle, b.handle].sort());
  });

  it("delivers to someone who was offline, in order, when they come back", async () => {
    const a = await makeUser(server.url, handle("a2"));
    const b = await makeUser(server.url, handle("b2"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    for (const text of ["hey", "are you around?", "call me"]) await send(a, dm.id, text);

    const [conv] = await list(b);
    expect(conv!.unread).toBe(3);
    expect(conv!.lastMessage?.body).toBe("call me");
    const { messages } = (await request(app).get(`/api/conversations/${dm.id}/messages`).set(b.auth)).body;
    expect(messages.map((m: ChatMessage) => m.body)).toEqual(["hey", "are you around?", "call me"]);
    expect(messages.map((m: ChatMessage) => m.seq)).toEqual(
      [...messages.map((m: ChatMessage) => m.seq)].sort((x, y) => x - y),
    );

    // Catching up after a reconnect: only what's newer than the last seq you have.
    const after = (
      await request(app).get(`/api/conversations/${dm.id}/messages?after=${messages[0].seq}`).set(b.auth)
    ).body;
    expect(after.messages.map((m: ChatMessage) => m.body)).toEqual(["are you around?", "call me"]);
  });

  it("never duplicates a message that is sent twice (e.g. after a dropped connection)", async () => {
    const a = await makeUser(server.url, handle("a3"));
    const b = await makeUser(server.url, handle("b3"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    const id = uuid();
    const first = await send(a, dm.id, "only once", id);
    const again = await send(a, dm.id, "only once", id);
    expect(again).toEqual(first);
    const { messages } = (await request(app).get(`/api/conversations/${dm.id}/messages`).set(a.auth)).body;
    expect(messages).toHaveLength(1);
    // Someone else can't reuse the id.
    const res = await request(app)
      .post(`/api/conversations/${dm.id}/messages`)
      .set(b.auth)
      .send({ id, body: "mine now" });
    expect(res.status).toBe(409);
  });

  it("arrives live, with delivered and read receipts and typing", async () => {
    const a = await makeUser(server.url, handle("a4"));
    const b = await makeUser(server.url, handle("b4"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    const aEvents = await openEvents(server.url, a.token);
    const bEvents = await openEvents(server.url, b.token);

    await request(app).post(`/api/conversations/${dm.id}/typing`).set(a.auth).expect(200);
    await bEvents.waitFor(
      (e): e is Extract<ServerEvent, { type: "typing" }> => e.type === "typing" && e.userId === a.id,
    );

    const msg = await send(a, dm.id, "live!");
    const got = await bEvents.waitFor(
      (e): e is Extract<ServerEvent, { type: "message" }> => e.type === "message",
    );
    expect(got.message).toEqual(msg);

    await request(app)
      .post(`/api/conversations/${dm.id}/receipts`)
      .set(b.auth)
      .send({ deliveredSeq: msg.seq })
      .expect(200);
    const delivered = await aEvents.waitFor(
      (e): e is Extract<ServerEvent, { type: "receipt" }> =>
        e.type === "receipt" && e.deliveredSeq === msg.seq,
    );
    expect(delivered.readSeq).toBe(0);
    await request(app)
      .post(`/api/conversations/${dm.id}/receipts`)
      .set(b.auth)
      .send({ readSeq: msg.seq })
      .expect(200);
    await aEvents.waitFor(
      (e): e is Extract<ServerEvent, { type: "receipt" }> => e.type === "receipt" && e.readSeq === msg.seq,
    );
    expect((await list(b))[0]!.unread).toBe(0);
    // Receipts can't run ahead of the chat or go backwards.
    const bogus = await request(app)
      .post(`/api/conversations/${dm.id}/receipts`)
      .set(b.auth)
      .send({ readSeq: 999_999_999 });
    expect(bogus.body.readSeq).toBe(msg.seq);
    const back = await request(app)
      .post(`/api/conversations/${dm.id}/receipts`)
      .set(b.auth)
      .send({ readSeq: 0 });
    expect(back.body.readSeq).toBe(msg.seq);
    await aEvents.close();
    await bEvents.close();
  });

  it("hides read receipts both ways when someone turns them off", async () => {
    const a = await makeUser(server.url, handle("a5"));
    const b = await makeUser(server.url, handle("b5"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    const msg = await send(a, dm.id, "did you read this?");
    await request(app).patch("/api/settings").set(b.auth).send({ readReceipts: false }).expect(200);
    await request(app).post(`/api/conversations/${dm.id}/receipts`).set(b.auth).send({ readSeq: msg.seq });
    const forA = (await list(a))[0]!.members.find((m) => m.profile.id === b.id)!;
    expect(forA.readSeq).toBeNull();
    expect(forA.deliveredSeq).toBe(msg.seq);
    // And B doesn't see A's read receipts either.
    await send(b, dm.id, "yes");
    await request(app).post(`/api/conversations/${dm.id}/receipts`).set(a.auth).send({ readSeq: 1e9 });
    const forB = (await list(b))[0]!.members.find((m) => m.profile.id === a.id)!;
    expect(forB.readSeq).toBeNull();
  });

  it("pages back through long histories", async () => {
    const a = await makeUser(server.url, handle("a6"));
    const b = await makeUser(server.url, handle("b6"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    for (let i = 0; i < 60; i++) {
      await deps.chat.send(uuid(), dm.id, i % 2 ? a.id : b.id, `m${i}`);
    }
    const page1 = (await request(app).get(`/api/conversations/${dm.id}/messages?limit=25`).set(a.auth)).body
      .messages;
    expect(page1.map((m: ChatMessage) => m.body)).toEqual(Array.from({ length: 25 }, (_, i) => `m${i + 35}`));
    const page2 = (
      await request(app)
        .get(`/api/conversations/${dm.id}/messages?limit=25&before=${page1[0].seq}`)
        .set(a.auth)
    ).body.messages;
    expect(page2.map((m: ChatMessage) => m.body)).toEqual(Array.from({ length: 25 }, (_, i) => `m${i + 10}`));
  });

  it("edits within 5 minutes and deletes for everyone", async () => {
    const a = await makeUser(server.url, handle("a7"));
    const b = await makeUser(server.url, handle("b7"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    const msg = await send(a, dm.id, "helo");
    const bEvents = await openEvents(server.url, b.token);
    const edited = await request(app).patch(`/api/messages/${msg.id}`).set(a.auth).send({ body: "hello" });
    expect(edited.body.message).toMatchObject({ body: "hello", seq: msg.seq });
    expect(edited.body.message.editedAt).not.toBeNull();
    await bEvents.waitFor((e): e is ServerEvent => e.type === "message_updated");
    expect(
      (await request(app).patch(`/api/messages/${msg.id}`).set(b.auth).send({ body: "hacked" })).status,
    ).toBe(403);
    await expect(deps.chat.edit(msg.id, a.id, "too late", Date.now() + 6 * 60 * 1000)).rejects.toThrow(
      ChatError,
    );

    await request(app).delete(`/api/messages/${msg.id}`).set(a.auth).expect(200);
    const { messages } = (await request(app).get(`/api/conversations/${dm.id}/messages`).set(b.auth)).body;
    expect(messages[0]).toMatchObject({ id: msg.id, deleted: true, body: "" });
    expect(
      (await request(app).patch(`/api/messages/${msg.id}`).set(a.auth).send({ body: "back" })).status,
    ).toBe(404);
    await bEvents.close();
  });

  it("rate-limits very fast senders", async () => {
    const a = await makeUser(server.url, handle("a8"));
    const b = await makeUser(server.url, handle("b8"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      statuses.push(
        (
          await request(app)
            .post(`/api/conversations/${dm.id}/messages`)
            .set(a.auth)
            .send({ id: uuid(), body: `${i}` })
        ).status,
      );
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(429);
  });

  it("keeps other people out of your chats (API and database)", async () => {
    const a = await makeUser(server.url, handle("a9"));
    const b = await makeUser(server.url, handle("b9"));
    const c = await makeUser(server.url, handle("c9"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    await send(a, dm.id, "private");
    expect((await request(app).get(`/api/conversations/${dm.id}/messages`).set(c.auth)).status).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/conversations/${dm.id}/messages`)
          .set(c.auth)
          .send({ id: uuid(), body: "hi" })
      ).status,
    ).toBe(404);
    const rls = await userClient(c.token).from("messages").select("body");
    expect(rls.data).toEqual([]);
    const own = await userClient(b.token).from("messages").select("body");
    expect(own.data?.map((m) => m.body)).toEqual(["private"]);
  });
});

describe("group chats", () => {
  it("are made of friends, can be renamed, and people can leave", async () => {
    const a = await makeUser(server.url, handle("ga"));
    const b = await makeUser(server.url, handle("gb"));
    const c = await makeUser(server.url, handle("gc"));
    const stranger = await makeUser(server.url, handle("gd"));
    await friends(a, b);
    await friends(a, c);
    const bad = await request(app)
      .post("/api/conversations/group")
      .set(a.auth)
      .send({ name: "Pals", icon: "star", memberIds: [b.id, stranger.id] });
    expect(bad.status).toBe(403);
    const group = (
      await request(app)
        .post("/api/conversations/group")
        .set(a.auth)
        .send({ name: "Pals", icon: "star", memberIds: [b.id, c.id] })
    ).body as ConversationSummary;
    expect(group.members).toHaveLength(3);

    // B and C aren't friends with each other, but both see the group chat.
    await send(b, group.id, "hi all");
    expect((await list(c)).find((x) => x.id === group.id)!.lastMessage?.body).toBe("hi all");

    const renamed = await request(app)
      .patch(`/api/conversations/${group.id}`)
      .set(c.auth)
      .send({ name: "Best pals", icon: "moon" });
    expect(renamed.body).toMatchObject({ name: "Best pals", icon: "moon" });

    await request(app).delete(`/api/conversations/${group.id}/members/me`).set(c.auth).expect(200);
    expect((await list(c)).find((x) => x.id === group.id)).toBeUndefined();
    expect((await request(app).get(`/api/conversations/${group.id}/messages`).set(c.auth)).status).toBe(404);
  });

  it("hide messages from muted and blocked people", async () => {
    const a = await makeUser(server.url, handle("ha"));
    const b = await makeUser(server.url, handle("hb"));
    const c = await makeUser(server.url, handle("hc"));
    await friends(a, b);
    await friends(a, c);
    const group = (
      await request(app)
        .post("/api/conversations/group")
        .set(a.auth)
        .send({ name: "Trio", icon: "sun", memberIds: [b.id, c.id] })
    ).body as ConversationSummary;
    await send(b, group.id, "from b");
    await send(c, group.id, "from c");
    await request(app).post("/api/mutes").set(a.auth).send({ userId: b.id });
    const seen = (await request(app).get(`/api/conversations/${group.id}/messages`).set(a.auth)).body
      .messages;
    expect(seen.map((m: ChatMessage) => m.body)).toEqual(["from c"]);
    await request(app).post("/api/blocks").set(c.auth).send({ userId: b.id });
    const seenByC = (await request(app).get(`/api/conversations/${group.id}/messages`).set(c.auth)).body
      .messages;
    expect(seenByC.map((m: ChatMessage) => m.body)).toEqual(["from c"]);
  });

  it(`hold at most ${GROUP_MAX_MEMBERS} people`, async () => {
    const creator = crypto.randomUUID();
    const members = Array.from({ length: GROUP_MAX_MEMBERS }, () => crypto.randomUUID());
    await expect(deps.chat.createGroup(creator, "Too big", "star", members)).rejects.toThrow(ChatError);
  });
});

describe("push notifications", () => {
  it("go to people who are offline, respecting their settings and quiet hours", async () => {
    const a = await makeUser(server.url, handle("pa"));
    const b = await makeUser(server.url, handle("pb"));
    await friends(a, b);
    const dm = await dmBetween(a, b);
    await request(app)
      .post("/api/push/subscriptions")
      .set(b.auth)
      .send({
        endpoint: `https://push.example/${b.id}`,
        keys: {
          p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
          auth: "tBHItJI5svbpez7KI4CCXg",
        },
      })
      .expect(200);
    const pushedTo = () => deps.pushed.filter((p) => p.endpoint.endsWith(b.id));

    // B is offline: they get a notification for the DM.
    await send(a, dm.id, "you there?");
    await expect.poll(() => pushedTo().length).toBe(1);
    expect(pushedTo()[0]!.payload).toMatchObject({
      title: a.handle,
      body: "you there?",
      url: `/?chat=${dm.id}`,
    });

    // B is connected: no push.
    const bEvents = await openEvents(server.url, b.token);
    await send(a, dm.id, "never mind, you're here");
    await new Promise((r) => setTimeout(r, 200));
    expect(pushedTo()).toHaveLength(1);
    await bEvents.close();
    await new Promise((r) => setTimeout(r, 100));

    // B turned DM notifications off: no push.
    await request(app)
      .patch("/api/settings")
      .set(b.auth)
      .send({ notifications: { dm: false } });
    await send(a, dm.id, "hello?");
    await new Promise((r) => setTimeout(r, 200));
    expect(pushedTo()).toHaveLength(1);

    // Friend requests have their own switch.
    const c = await makeUser(server.url, handle("pc"));
    await request(app).post("/api/friends/requests").set(c.auth).send({ handle: b.handle });
    await expect.poll(() => pushedTo().length).toBe(2);
    expect(pushedTo()[1]!.payload.title).toBe("New friend request");
  });

  it("checks quiet hours in the person's own time zone, including overnight", () => {
    const s = (start: string, end: string, timeZone = "UTC") =>
      settingsSchema.parse({ quietHours: { enabled: true, start, end }, timeZone });
    const at = (iso: string) => new Date(iso);
    expect(inQuietHours(s("22:00", "07:00"), at("2026-09-27T23:30:00Z"))).toBe(true);
    expect(inQuietHours(s("22:00", "07:00"), at("2026-09-27T06:59:00Z"))).toBe(true);
    expect(inQuietHours(s("22:00", "07:00"), at("2026-09-27T07:00:00Z"))).toBe(false);
    expect(inQuietHours(s("13:00", "14:00"), at("2026-09-27T13:30:00Z"))).toBe(true);
    // 23:30 UTC is 19:30 in New York: not quiet there.
    expect(inQuietHours(s("22:00", "07:00", "America/New_York"), at("2026-09-27T23:30:00Z"))).toBe(false);
    expect(inQuietHours(settingsSchema.parse({}), at("2026-09-27T23:30:00Z"))).toBe(false);
  });
});

describe("presence", () => {
  it("tells friends when you come online, go away, set Do Not Disturb, appear offline and leave", async () => {
    const a = await makeUser(server.url, handle("ra"));
    const b = await makeUser(server.url, handle("rb"));
    await friends(a, b);
    const aEvents = await openEvents(server.url, a.token);
    type P = Extract<ServerEvent, { type: "presence" }>;
    const next = (status: string) =>
      aEvents.waitFor(
        (e): e is P => e.type === "presence" && e.userId === b.id && e.presence.status === status,
      );

    const bEvents = await openEvents(server.url, b.token);
    await next("online");
    await request(app).post("/api/presence").set(b.auth).send({ away: true });
    await next("away");
    await request(app).patch("/api/settings").set(b.auth).send({ presence: "dnd" });
    await next("dnd");
    await request(app).patch("/api/settings").set(b.auth).send({ presence: "invisible" });
    await next("offline");
    const listed = (await request(app).get("/api/friends").set(a.auth)).body.friends[0];
    expect(listed.presence.status).toBe("offline");
    await request(app).patch("/api/settings").set(b.auth).send({ presence: "auto" });
    await next("away");
    aEvents.events.length = 0;
    await bEvents.close();
    await next("offline");
    await aEvents.close();
  });
});
