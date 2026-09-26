import { formatFriendCode, type FriendsResponse, type ServerEvent } from "@hearth/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteTestUsers,
  listen,
  makeLocalApp,
  makeSocial,
  makeUser,
  openEvents,
  type TestUser,
} from "./local";

const deps = makeSocial();
const app = makeLocalApp(deps);
let server: Awaited<ReturnType<typeof listen>>;
const run = Date.now().toString(36).slice(-4);
const handle = (name: string) => `s${run}_${name}`;

async function friendsOf(u: TestUser): Promise<FriendsResponse> {
  return (await request(app).get("/api/friends").set(u.auth)).body;
}

async function befriend(a: TestUser, b: TestUser) {
  await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle }).expect(200);
  const req = (await friendsOf(b)).incoming.find((r) => r.profile.id === a.id)!;
  await request(app).post(`/api/friends/requests/${req.id}/accept`).set(b.auth).expect(200);
}

beforeAll(async () => {
  await deleteTestUsers();
  server = await listen(app);
});
afterAll(async () => {
  await server.close();
  await deps.sql.end();
});

describe("friends", () => {
  it("sends, sees and accepts a request by handle, telling both people live", async () => {
    const a = await makeUser(server.url, handle("ann"));
    const b = await makeUser(server.url, handle("bo"));
    const aEvents = await openEvents(server.url, a.token);
    const bEvents = await openEvents(server.url, b.token);

    const sent = await request(app)
      .post("/api/friends/requests")
      .set(a.auth)
      .send({ handle: b.handle.toUpperCase() });
    expect(sent.body).toEqual({ status: "requested" });
    await bEvents.waitFor((e): e is ServerEvent => e.type === "friends_changed");
    expect((await friendsOf(a)).outgoing.map((r) => r.profile.handle)).toEqual([b.handle]);
    const incoming = (await friendsOf(b)).incoming;
    expect(incoming.map((r) => r.profile.handle)).toEqual([a.handle]);
    expect(incoming[0]!.profile.appearance).toBeTruthy();

    await request(app).post(`/api/friends/requests/${incoming[0]!.id}/accept`).set(b.auth).expect(200);
    const fa = await friendsOf(a);
    expect(fa.friends.map((f) => f.profile.handle)).toEqual([b.handle]);
    expect(fa.outgoing).toEqual([]);
    // B has an open event stream, so A sees B online.
    expect(fa.friends[0]!.presence.status).toBe("online");
    await aEvents.waitFor((e): e is ServerEvent => e.type === "friends_changed");
    await aEvents.close();
    await bEvents.close();
  });

  it("accepts automatically when both people ask each other", async () => {
    const a = await makeUser(server.url, handle("cy"));
    const b = await makeUser(server.url, handle("di"));
    await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle }).expect(200);
    const res = await request(app).post("/api/friends/requests").set(b.auth).send({ handle: a.handle });
    expect(res.body).toEqual({ status: "accepted" });
    expect((await friendsOf(a)).friends).toHaveLength(1);
    expect((await friendsOf(b)).incoming).toEqual([]);
  });

  it("adds by friend code, in any format, and regenerating the code retires the old one", async () => {
    const a = await makeUser(server.url, handle("ed"));
    const b = await makeUser(server.url, handle("fi"));
    const { body } = await request(app).get("/api/friends/code").set(b.auth);
    expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(body.inviteUrl).toBe(`http://localhost:5173/add/${body.code}`);
    // The same code comes back until it's regenerated.
    expect((await request(app).get("/api/friends/code").set(b.auth)).body.code).toBe(body.code);

    const lookup = await request(app)
      .get(`/api/friends/code/${formatFriendCode(body.code).toLowerCase()}`)
      .set(a.auth);
    expect(lookup.body.profile.handle).toBe(b.handle);
    expect(lookup.body.relationship).toBe("none");

    const fresh = (await request(app).post("/api/friends/code/regenerate").set(b.auth)).body.code;
    expect(fresh).not.toBe(body.code);
    expect(
      (await request(app).post("/api/friends/requests").set(a.auth).send({ code: body.code })).status,
    ).toBe(404);
    const res = await request(app)
      .post("/api/friends/requests")
      .set(a.auth)
      .send({ code: formatFriendCode(fresh) });
    expect(res.body).toEqual({ status: "requested" });
  });

  it("rejects unknown handles and yourself", async () => {
    const a = await makeUser(server.url, handle("gu"));
    expect(
      (await request(app).post("/api/friends/requests").set(a.auth).send({ handle: "nobody_here_xyz" }))
        .status,
    ).toBe(404);
    expect(
      (await request(app).post("/api/friends/requests").set(a.auth).send({ handle: a.handle })).status,
    ).toBe(400);
    expect((await request(app).get("/api/users/nobody_here_xyz").set(a.auth)).status).toBe(404);
  });

  it("declines, cancels and unfriends", async () => {
    const a = await makeUser(server.url, handle("ha"));
    const b = await makeUser(server.url, handle("io"));
    await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle });
    const req = (await friendsOf(b)).incoming[0]!;
    await request(app).delete(`/api/friends/requests/${req.id}`).set(b.auth).expect(200); // decline
    expect((await friendsOf(a)).outgoing).toEqual([]);
    await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle });
    const again = (await friendsOf(a)).outgoing[0]!;
    await request(app).delete(`/api/friends/requests/${again.id}`).set(a.auth).expect(200); // cancel
    expect((await friendsOf(b)).incoming).toEqual([]);
    // Someone else can't remove your request.
    await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle });
    const c = await makeUser(server.url, handle("ju"));
    const third = (await friendsOf(b)).incoming[0]!;
    expect((await request(app).delete(`/api/friends/requests/${third.id}`).set(c.auth)).status).toBe(404);
    await request(app).post(`/api/friends/requests/${third.id}/accept`).set(b.auth).expect(200);
    await request(app).delete(`/api/friends/${a.id}`).set(b.auth).expect(200);
    expect((await friendsOf(a)).friends).toEqual([]);
  });
});

describe("blocking", () => {
  it("ends the friendship, hides both people from each other, and stays silent", async () => {
    const a = await makeUser(server.url, handle("ka"));
    const b = await makeUser(server.url, handle("lu"));
    await befriend(a, b);
    const dm = (await request(app).post("/api/conversations/dm").set(a.auth).send({ userId: b.id })).body;

    await request(app).post("/api/blocks").set(b.auth).send({ userId: a.id }).expect(200);
    expect((await friendsOf(a)).friends).toEqual([]);
    expect((await friendsOf(b)).friends).toEqual([]);
    // A can't find B, and B can't find A.
    expect((await request(app).get(`/api/users/${b.handle}`).set(a.auth)).status).toBe(404);
    expect((await request(app).get(`/api/users/${a.handle}`).set(b.auth)).status).toBe(404);
    // A's new friend request looks sent but does nothing.
    const res = await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle });
    expect(res.body).toEqual({ status: "requested" });
    expect((await friendsOf(b)).incoming).toEqual([]);
    expect((await friendsOf(a)).outgoing).toEqual([]);
    // Neither can message the other.
    const send = await request(app)
      .post(`/api/conversations/${dm.id}/messages`)
      .set(a.auth)
      .send({ id: crypto.randomUUID(), body: "hello?" });
    expect(send.status).toBe(403);
    expect((await request(app).post("/api/conversations/dm").set(a.auth).send({ userId: b.id })).status).toBe(
      403,
    );
    // B's block list shows A; unblocking lets them find each other again (but not as friends).
    expect(
      (await request(app).get("/api/blocks").set(b.auth)).body.blocked.map((p: { id: string }) => p.id),
    ).toEqual([a.id]);
    await request(app).delete(`/api/blocks/${a.id}`).set(b.auth).expect(200);
    expect((await request(app).get(`/api/users/${b.handle}`).set(a.auth)).body.relationship).toBe("none");
  });

  it("mutes without blocking", async () => {
    const a = await makeUser(server.url, handle("ma"));
    const b = await makeUser(server.url, handle("ni"));
    await befriend(a, b);
    await request(app).post("/api/mutes").set(a.auth).send({ userId: b.id }).expect(200);
    expect((await request(app).get("/api/mutes").set(a.auth)).body.muted).toEqual([b.id]);
    expect((await friendsOf(a)).friends).toHaveLength(1);
    await request(app).delete(`/api/mutes/${b.id}`).set(a.auth).expect(200);
    expect((await request(app).get("/api/mutes").set(a.auth)).body.muted).toEqual([]);
  });
});

describe("reports", () => {
  it("captures the reported message with the conversation around it", async () => {
    const a = await makeUser(server.url, handle("ol"));
    const b = await makeUser(server.url, handle("pe"));
    await befriend(a, b);
    const dm = (await request(app).post("/api/conversations/dm").set(a.auth).send({ userId: b.id })).body;
    const ids: string[] = [];
    for (let i = 0; i < 14; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      const who = i === 12 ? b : a;
      await request(app)
        .post(`/api/conversations/${dm.id}/messages`)
        .set(who.auth)
        .send({ id, body: `line ${i}` })
        .expect(200);
    }
    // B deletes the message before A reports it; moderators still see what was said.
    await request(app).delete(`/api/messages/${ids[12]}`).set(b.auth).expect(200);
    const res = await request(app).post("/api/reports").set(a.auth).send({
      kind: "message",
      targetUserId: b.id,
      targetId: ids[12],
      reason: "harassment",
      note: "not nice",
    });
    expect(res.status).toBe(200);
    const [row] = await deps.sql<
      { context: { target: { body: string }; messages: { body: string }[] }; reporter: string }[]
    >`
      select context, reporter from public.reports where id = ${res.body.id}`;
    expect(row!.reporter).toBe(a.id);
    expect(row!.context.messages.map((m) => m.body)).toEqual(
      Array.from({ length: 12 }, (_, i) => `line ${i + 2}`),
    );

    // You can't report a message from a chat you're not in.
    const c = await makeUser(server.url, handle("qu"));
    const other = await request(app)
      .post("/api/reports")
      .set(c.auth)
      .send({ kind: "message", targetUserId: b.id, targetId: ids[12], reason: "spam" });
    expect(other.status).toBe(404);
  });

  it("captures the profile for user reports", async () => {
    const a = await makeUser(server.url, handle("ra"));
    const b = await makeUser(server.url, handle("si"));
    const res = await request(app)
      .post("/api/reports")
      .set(a.auth)
      .send({ kind: "profile", targetUserId: b.id, reason: "impersonation" });
    const [row] = await deps.sql<
      { context: { profile: { handle: string } } }[]
    >`select context from public.reports where id = ${res.body.id}`;
    expect(row!.context.profile.handle).toBe(b.handle);
  });
});
