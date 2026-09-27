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
const handle = (name: string) => `l${run}_${name}`;

async function befriend(a: Awaited<ReturnType<typeof makeUser>>, b: Awaited<ReturnType<typeof makeUser>>) {
  await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle }).expect(200);
  const incoming = (await request(app).get("/api/friends").set(b.auth)).body.incoming;
  const req = incoming.find((r: { profile: { handle: string } }) => r.profile.handle === a.handle);
  await request(app).post(`/api/friends/requests/${req.id}/accept`).set(b.auth).expect(200);
}

beforeAll(async () => {
  await deleteTestUsers();
  server = await listen(app);
});
afterAll(async () => {
  await server.close();
  await social.sql.end();
});

describe("letters", () => {
  it("can only be sent to friends", async () => {
    const a = await makeUser(server.url, handle("strangera"));
    const b = await makeUser(server.url, handle("strangerb"));
    const res = await request(app).post("/api/letters").set(a.auth).send({ toUserId: b.id, body: "hi" });
    expect(res.status).toBe(403);
  });

  it("escrows attachments and coins out of the sender immediately; the recipient gets them only on claim", async () => {
    const a = await makeUser(server.url, handle("sender"));
    const b = await makeUser(server.url, handle("recipient"));
    await befriend(a, b);
    await giveCoins(social.sql, a.id, 200);
    await grantItem(social.sql, a.id, "seashell", 3, true);

    const sent = await request(app)
      .post("/api/letters")
      .set(a.auth)
      .send({
        toUserId: b.id,
        subject: "Hi",
        body: "Here's a gift!",
        items: [{ itemId: "seashell", quantity: 2 }],
        coins: 50,
      })
      .expect(200);
    expect(sent.body.fromProfile.handle).toBe(a.handle);

    // The sender paid immediately.
    expect((await request(app).get("/api/wallet").set(a.auth)).body.balance).toBe(150);
    const senderInv = (await request(app).get("/api/inventory").set(a.auth)).body.inventory;
    expect(senderInv).toMatchObject([{ itemId: "seashell", quantity: 1 }]);

    // The recipient has nothing yet.
    expect((await request(app).get("/api/wallet").set(b.auth)).body.balance).toBe(0);
    expect((await request(app).get("/api/inventory").set(b.auth)).body.inventory).toEqual([]);
    const inbox = (await request(app).get("/api/letters").set(b.auth)).body;
    expect(inbox.mailboxFlag).toBe(true);
    expect(inbox.letters).toHaveLength(1);
    const letterId = inbox.letters[0].id;

    const claimed = await request(app).post(`/api/letters/${letterId}/claim`).set(b.auth).expect(200);
    expect(claimed.body.claimedAt).toBeTruthy();
    expect((await request(app).get("/api/wallet").set(b.auth)).body.balance).toBe(50);
    const recipientInv = (await request(app).get("/api/inventory").set(b.auth)).body.inventory;
    expect(recipientInv).toMatchObject([{ itemId: "seashell", quantity: 2 }]);

    // Claiming again does not grant a second time.
    await request(app).post(`/api/letters/${letterId}/claim`).set(b.auth).expect(200);
    expect((await request(app).get("/api/wallet").set(b.auth)).body.balance).toBe(50);
    expect((await request(app).get("/api/inventory").set(b.auth)).body.inventory).toMatchObject([
      { itemId: "seashell", quantity: 2 },
    ]);

    const mailboxAfter = (await request(app).get("/api/letters").set(b.auth)).body;
    expect(mailboxAfter.mailboxFlag).toBe(false);
  });

  it("refuses a non-tradeable attachment, and refuses stationery you don't own", async () => {
    const a = await makeUser(server.url, handle("sender2"));
    const b = await makeUser(server.url, handle("recipient2"));
    await befriend(a, b);
    await grantItem(social.sql, a.id, "founders_badge", 1, false);

    const badItem = await request(app)
      .post("/api/letters")
      .set(a.auth)
      .send({ toUserId: b.id, body: "hi", items: [{ itemId: "founders_badge", quantity: 1 }] });
    expect(badItem.status).toBe(400);
    expect(badItem.body.error).toBe("not_tradeable");

    const badStationery = await request(app)
      .post("/api/letters")
      .set(a.auth)
      .send({ toUserId: b.id, body: "hi", stationeryId: "star_stationery" });
    expect(badStationery.status).toBe(400);
    expect(badStationery.body.error).toBe("stationery_not_owned");
  });

  it("the default stationery needs no purchase", async () => {
    const a = await makeUser(server.url, handle("sender3"));
    const b = await makeUser(server.url, handle("recipient3"));
    await befriend(a, b);
    const res = await request(app).post("/api/letters").set(a.auth).send({ toUserId: b.id, body: "hello" });
    expect(res.status).toBe(200);
    expect(res.body.stationeryId).toBe("plain_paper");
  });

  it("a letter to yourself is refused", async () => {
    const a = await makeUser(server.url, handle("self"));
    const res = await request(app).post("/api/letters").set(a.auth).send({ toUserId: a.id, body: "hi" });
    expect(res.status).toBe(400);
  });
});
