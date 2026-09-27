import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteTestUsers,
  giveCoins,
  grantItem,
  listen,
  makeEconomy,
  makeLocalApp,
  makeSocial,
  makeUser,
} from "./local";

const social = makeSocial();
const economy = makeEconomy(social);
const app = makeLocalApp(social, economy);
let server: Awaited<ReturnType<typeof listen>>;
const run = Date.now().toString(36).slice(-4);
const handle = (name: string) => `h${run}_${name}`;

async function befriend(
  aAuth: { authorization: string },
  aHandle: string,
  bAuth: { authorization: string },
  bHandle: string,
) {
  await request(app).post("/api/friends/requests").set(aAuth).send({ handle: bHandle }).expect(200);
  const incoming = (await request(app).get("/api/friends").set(bAuth)).body.incoming;
  const req = incoming.find((r: { profile: { handle: string } }) => r.profile.handle === aHandle);
  await request(app).post(`/api/friends/requests/${req.id}/accept`).set(bAuth).expect(200);
}

beforeAll(async () => {
  await deleteTestUsers();
  server = await listen(app);
});
afterAll(async () => {
  await server.close();
  await social.sql.end();
});

describe("home access", () => {
  it("defaults to open to friends: a friend can enter, a stranger can't", async () => {
    const owner = await makeUser(server.url, handle("owner1"));
    const friend = await makeUser(server.url, handle("friend1"));
    const stranger = await makeUser(server.url, handle("stranger1"));
    await befriend(owner.auth, owner.handle, friend.auth, friend.handle);

    const summary = await request(app).get(`/api/homes/${owner.id}`).set(friend.auth).expect(200);
    expect(summary.body.access).toBe("friends");

    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(friend.auth)).body).toEqual({
      canEnter: true,
    });
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(stranger.auth)).body).toEqual({
      canEnter: false,
    });
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(owner.auth)).body).toEqual({
      canEnter: true,
    });
  });

  it("'invite' access lets in only guests on the list", async () => {
    const owner = await makeUser(server.url, handle("owner2"));
    const guest = await makeUser(server.url, handle("guest2"));
    const other = await makeUser(server.url, handle("other2"));
    await befriend(owner.auth, owner.handle, guest.auth, guest.handle);
    await befriend(owner.auth, owner.handle, other.auth, other.handle);

    await request(app).put("/api/homes/access").set(owner.auth).send({ access: "invite" }).expect(200);
    // Friends are refused now, until invited.
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(guest.auth)).body.canEnter).toBe(
      false,
    );

    await request(app).post("/api/homes/guests").set(owner.auth).send({ userId: guest.id }).expect(200);
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(guest.auth)).body.canEnter).toBe(true);
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(other.auth)).body.canEnter).toBe(
      false,
    );

    const mine = await request(app).get(`/api/homes/${owner.id}`).set(owner.auth).expect(200);
    expect(mine.body.guests.map((g: { handle: string }) => g.handle)).toEqual([guest.handle]);

    await request(app).delete(`/api/homes/guests/${guest.id}`).set(owner.auth).expect(200);
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(guest.auth)).body.canEnter).toBe(
      false,
    );
  });

  it("'closed' access refuses everyone but the owner", async () => {
    const owner = await makeUser(server.url, handle("owner3"));
    const friend = await makeUser(server.url, handle("friend3"));
    await befriend(owner.auth, owner.handle, friend.auth, friend.handle);
    await request(app).put("/api/homes/access").set(owner.auth).send({ access: "closed" }).expect(200);
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(friend.auth)).body.canEnter).toBe(
      false,
    );
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(owner.auth)).body.canEnter).toBe(true);
  });

  it("adding a guest who isn't your friend is refused", async () => {
    const owner = await makeUser(server.url, handle("owner4"));
    const stranger = await makeUser(server.url, handle("stranger4"));
    const res = await request(app).post("/api/homes/guests").set(owner.auth).send({ userId: stranger.id });
    expect(res.status).toBe(403);
  });

  it("a blocked visitor is refused even when they're a friend", async () => {
    const owner = await makeUser(server.url, handle("owner5"));
    const friend = await makeUser(server.url, handle("friend5"));
    await befriend(owner.auth, owner.handle, friend.auth, friend.handle);
    await request(app).post("/api/blocks").set(owner.auth).send({ userId: friend.id }).expect(200);
    expect((await request(app).get(`/api/homes/${owner.id}/entry`).set(friend.auth)).body.canEnter).toBe(
      false,
    );
  });
});

describe("furniture", () => {
  it("places furniture from inventory and can remove it, returning it to inventory", async () => {
    const owner = await makeUser(server.url, handle("deco1"));
    await grantItem(social.sql, owner.id, "wooden_chair", 1, false);

    const placed = await request(app)
      .post("/api/homes/furniture")
      .set(owner.auth)
      .send({ itemId: "wooden_chair", x: 2, y: 3 })
      .expect(200);
    expect(placed.body).toMatchObject({ itemId: "wooden_chair", x: 2, y: 3 });
    expect((await request(app).get("/api/inventory").set(owner.auth)).body.inventory).toEqual([]);

    const list = await request(app).get(`/api/homes/${owner.id}/furniture`).set(owner.auth).expect(200);
    expect(list.body.furniture).toHaveLength(1);

    await request(app).delete(`/api/homes/furniture/${placed.body.id}`).set(owner.auth).expect(200);
    const after = await request(app).get(`/api/homes/${owner.id}/furniture`).set(owner.auth).expect(200);
    expect(after.body.furniture).toEqual([]);
    const inv = (await request(app).get("/api/inventory").set(owner.auth)).body.inventory;
    expect(inv).toMatchObject([{ itemId: "wooden_chair", quantity: 1 }]);
  });

  it("refuses to place two items on the same tile, and refuses a non-furniture item", async () => {
    const owner = await makeUser(server.url, handle("deco2"));
    await grantItem(social.sql, owner.id, "wooden_chair", 2, false);
    await request(app)
      .post("/api/homes/furniture")
      .set(owner.auth)
      .send({ itemId: "wooden_chair", x: 0, y: 0 })
      .expect(200);
    const conflict = await request(app)
      .post("/api/homes/furniture")
      .set(owner.auth)
      .send({ itemId: "wooden_chair", x: 0, y: 0 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("tile_taken");

    await giveCoins(social.sql, owner.id, 100);
    await grantItem(social.sql, owner.id, "bandana", 1, false);
    const notFurniture = await request(app)
      .post("/api/homes/furniture")
      .set(owner.auth)
      .send({ itemId: "bandana", x: 1, y: 1 });
    expect(notFurniture.status).toBe(400);
    expect(notFurniture.body.error).toBe("not_furniture");
  });

  it("visiting someone's home whose access refuses you also refuses reading their furniture", async () => {
    const owner = await makeUser(server.url, handle("deco3"));
    const stranger = await makeUser(server.url, handle("stranger3"));
    const res = await request(app).get(`/api/homes/${owner.id}/furniture`).set(stranger.auth);
    expect(res.status).toBe(403);
  });
});
