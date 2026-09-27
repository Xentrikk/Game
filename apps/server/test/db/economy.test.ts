import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteTestUsers, giveCoins, listen, makeEconomy, makeLocalApp, makeSocial, makeUser } from "./local";

const social = makeSocial();
const economy = makeEconomy(social);
const app = makeLocalApp(social, economy);
let server: Awaited<ReturnType<typeof listen>>;
const run = Date.now().toString(36).slice(-4);
const handle = (name: string) => `e${run}_${name}`;

beforeAll(async () => {
  await deleteTestUsers();
  server = await listen(app);
});
afterAll(async () => {
  await server.close();
  await social.sql.end();
});

describe("wallet and inventory", () => {
  it("starts empty", async () => {
    const a = await makeUser(server.url, handle("empty"));
    expect((await request(app).get("/api/wallet").set(a.auth)).body).toEqual({ balance: 0 });
    expect((await request(app).get("/api/inventory").set(a.auth)).body).toEqual({ inventory: [] });
  });
});

describe("shop", () => {
  it("buys an item, debiting coins and granting it, and lists it for sale", async () => {
    const a = await makeUser(server.url, handle("buyer"));
    await giveCoins(social.sql, a.id, 1000);
    const shop = await request(app).get("/api/shop/boutique");
    expect(shop.body.items.some((i: { id: string }) => i.id === "bandana")).toBe(true);

    const key = crypto.randomUUID();
    const res = await request(app)
      .post("/api/shop/buy")
      .set(a.auth)
      .send({ itemId: "bandana", quantity: 1, idempotencyKey: key })
      .expect(200);
    expect(res.body.balance).toBe(940); // 1000 - 60
    expect(res.body.inventory).toHaveLength(1);
    expect(res.body.inventory[0]).toMatchObject({ itemId: "bandana", quantity: 1 });

    const ledger = (await request(app).get("/api/wallet/ledger").set(a.auth)).body.entries;
    expect(ledger[0]).toMatchObject({ delta: -60, reason: "shop_purchase", balanceAfter: 940 });
  });

  it("resending the same idempotency key does not buy twice", async () => {
    const a = await makeUser(server.url, handle("dupe"));
    await giveCoins(social.sql, a.id, 1000);
    const key = crypto.randomUUID();
    const buy = () =>
      request(app)
        .post("/api/shop/buy")
        .set(a.auth)
        .send({ itemId: "iced_tea", quantity: 3, idempotencyKey: key });
    const first = await buy().expect(200);
    const second = await buy().expect(200);
    expect(first.body).toEqual(second.body);
    expect(second.body.balance).toBe(970); // 1000 - 30, only once
    expect(second.body.inventory).toHaveLength(1);
    expect(second.body.inventory[0]).toMatchObject({ itemId: "iced_tea", quantity: 3 });
  });

  it("refuses to buy without enough coins, and refuses an item no shop sells", async () => {
    const a = await makeUser(server.url, handle("poor"));
    const poor = await request(app)
      .post("/api/shop/buy")
      .set(a.auth)
      .send({ itemId: "wizard_robe", quantity: 1, idempotencyKey: crypto.randomUUID() });
    expect(poor.status).toBe(409);
    expect(poor.body.error).toBe("insufficient_coins");

    await giveCoins(social.sql, a.id, 1000);
    const notForSale = await request(app)
      .post("/api/shop/buy")
      .set(a.auth)
      .send({ itemId: "founders_badge", quantity: 1, idempotencyKey: crypto.randomUUID() });
    expect(notForSale.status).toBe(400);
    expect(notForSale.body.error).toBe("not_for_sale");
  });

  it("sells an item back for its sell price, and refuses to sell more than you own", async () => {
    const a = await makeUser(server.url, handle("seller"));
    await giveCoins(social.sql, a.id, 1000);
    await request(app)
      .post("/api/shop/buy")
      .set(a.auth)
      .send({ itemId: "wooden_chair", quantity: 1, idempotencyKey: crypto.randomUUID() })
      .expect(200); // -50

    const sold = await request(app)
      .post("/api/shop/sell")
      .set(a.auth)
      .send({ itemId: "wooden_chair", quantity: 1, idempotencyKey: crypto.randomUUID() })
      .expect(200);
    expect(sold.body.balance).toBe(970); // 1000 - 50 + 20
    expect(sold.body.inventory).toEqual([]);

    const tooMany = await request(app)
      .post("/api/shop/sell")
      .set(a.auth)
      .send({ itemId: "wooden_chair", quantity: 1, idempotencyKey: crypto.randomUUID() });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error).toBe("insufficient_items");

    const notSellable = await request(app)
      .post("/api/shop/sell")
      .set(a.auth)
      .send({ itemId: "bandana", quantity: 1, idempotencyKey: crypto.randomUUID() });
    expect(notSellable.status).toBe(400);
    expect(notSellable.body.error).toBe("not_sellable");
  });
});

describe("daily gift", () => {
  it("claims coins once a day; claiming again the same day is a no-op", async () => {
    const a = await makeUser(server.url, handle("giftee"));
    const first = await request(app).post("/api/daily-gift/claim").set(a.auth).expect(200);
    expect(first.body.claimed).toBe(true);
    expect(first.body.coins).toBe(50);
    expect(first.body.balance).toBe(50);

    const second = await request(app).post("/api/daily-gift/claim").set(a.auth).expect(200);
    expect(second.body.claimed).toBe(false);
    expect(second.body.coins).toBe(0);
    expect(second.body.balance).toBe(50); // unchanged, not claimed twice
  });
});
