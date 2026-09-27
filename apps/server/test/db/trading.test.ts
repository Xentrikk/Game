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
  rawSql,
  soloSql,
} from "./local";

const social = makeSocial();
const economy = makeEconomy(social);
const app = makeLocalApp(social, economy);
let server: Awaited<ReturnType<typeof listen>>;
const run = Date.now().toString(36).slice(-4);
const handle = (name: string) => `t${run}_${name}`;

async function befriend(a: Awaited<ReturnType<typeof makeUser>>, b: Awaited<ReturnType<typeof makeUser>>) {
  await request(app).post("/api/friends/requests").set(a.auth).send({ handle: b.handle }).expect(200);
  const incoming = (await request(app).get("/api/friends").set(b.auth)).body.incoming;
  const req = incoming.find((r: { profile: { handle: string } }) => r.profile.handle === a.handle);
  await request(app).post(`/api/friends/requests/${req.id}/accept`).set(b.auth).expect(200);
}

async function openTrade(a: Awaited<ReturnType<typeof makeUser>>, b: Awaited<ReturnType<typeof makeUser>>) {
  const res = await request(app).post("/api/trades").set(a.auth).send({ userId: b.id }).expect(200);
  return res.body.id as string;
}

async function balanceAndInventory(userId: string) {
  const [wallet] = await social.sql<
    { balance: string }[]
  >`select balance from public.wallets where user_id = ${userId}`;
  const inv = await social.sql<{ item_id: string; quantity: number }[]>`
    select item_id, quantity from public.inventory_items where owner_id = ${userId} order by item_id`;
  return {
    balance: Number(wallet?.balance ?? 0),
    inventory: inv.map((r) => ({ itemId: r.item_id, quantity: r.quantity })),
  };
}

beforeAll(async () => {
  await deleteTestUsers();
  server = await listen(app);
});
afterAll(async () => {
  await server.close();
  await social.sql.end();
});

describe("trading", () => {
  it("can only be opened between friends, not with yourself", async () => {
    const a = await makeUser(server.url, handle("solo"));
    const b = await makeUser(server.url, handle("stranger"));
    expect((await request(app).post("/api/trades").set(a.auth).send({ userId: a.id })).status).toBe(400);
    expect((await request(app).post("/api/trades").set(a.auth).send({ userId: b.id })).status).toBe(403);
  });

  it("swaps items and coins exactly once both sides are ready", async () => {
    const a = await makeUser(server.url, handle("swapa"));
    const b = await makeUser(server.url, handle("swapb"));
    await befriend(a, b);
    await grantItem(social.sql, a.id, "seashell", 5, true);
    await giveCoins(social.sql, a.id, 100);
    await grantItem(social.sql, b.id, "koi_sticker", 2, true);
    await giveCoins(social.sql, b.id, 50);

    const tradeId = await openTrade(a, b);
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(a.auth)
      .send({ items: [{ itemId: "seashell", quantity: 2 }], coins: 10 })
      .expect(200);
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(b.auth)
      .send({ items: [{ itemId: "koi_sticker", quantity: 1 }], coins: 5 })
      .expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(a.auth).send({ ready: true }).expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(b.auth).send({ ready: true }).expect(200);

    const done = await request(app).post(`/api/trades/${tradeId}/confirm`).set(a.auth).expect(200);
    expect(done.body.status).toBe("completed");

    const aState = await balanceAndInventory(a.id);
    const bState = await balanceAndInventory(b.id);
    expect(aState.balance).toBe(95); // 100 - 10 + 5
    expect(aState.inventory).toEqual([
      { itemId: "koi_sticker", quantity: 1 },
      { itemId: "seashell", quantity: 3 },
    ]);
    expect(bState.balance).toBe(55); // 50 - 5 + 10
    expect(bState.inventory).toEqual([
      { itemId: "koi_sticker", quantity: 1 }, // 2 owned, gave away 1
      { itemId: "seashell", quantity: 2 },
    ]);
  });

  it("confirming twice does not swap twice (idempotent completion)", async () => {
    const a = await makeUser(server.url, handle("idema"));
    const b = await makeUser(server.url, handle("idemb"));
    await befriend(a, b);
    await grantItem(social.sql, a.id, "seashell", 1, true);

    const tradeId = await openTrade(a, b);
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(a.auth)
      .send({ items: [{ itemId: "seashell", quantity: 1 }], coins: 0 })
      .expect(200);
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(b.auth)
      .send({ items: [], coins: 0 })
      .expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(a.auth).send({ ready: true }).expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(b.auth).send({ ready: true }).expect(200);

    const first = await request(app).post(`/api/trades/${tradeId}/confirm`).set(a.auth).expect(200);
    const second = await request(app).post(`/api/trades/${tradeId}/confirm`).set(b.auth).expect(200);
    expect(first.body.completedAt).toBe(second.body.completedAt);

    const bState = await balanceAndInventory(b.id);
    expect(bState.inventory).toEqual([{ itemId: "seashell", quantity: 1 }]); // only once
  });

  it("changing an offer resets both sides' Ready", async () => {
    const a = await makeUser(server.url, handle("readya"));
    const b = await makeUser(server.url, handle("readyb"));
    await befriend(a, b);
    const tradeId = await openTrade(a, b);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(a.auth).send({ ready: true }).expect(200);
    let state = await request(app)
      .post(`/api/trades/${tradeId}/ready`)
      .set(b.auth)
      .send({ ready: true })
      .expect(200);
    expect(state.body.a.ready).toBe(true);
    expect(state.body.b.ready).toBe(true);

    // A changes their offer: both go back to not-ready.
    state = await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(a.auth)
      .send({ items: [], coins: 1 })
      .expect(200);
    expect(state.body.a.ready).toBe(false);
    expect(state.body.b.ready).toBe(false);

    const tooSoon = await request(app).post(`/api/trades/${tradeId}/confirm`).set(a.auth);
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error).toBe("not_both_ready");
  });

  it("refuses items you don't have enough of, and non-tradeable items", async () => {
    const a = await makeUser(server.url, handle("cheata"));
    const b = await makeUser(server.url, handle("cheatb"));
    await befriend(a, b);
    await grantItem(social.sql, a.id, "founders_badge", 1, false);
    const tradeId = await openTrade(a, b);

    const notTradeable = await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(a.auth)
      .send({ items: [{ itemId: "founders_badge", quantity: 1 }], coins: 0 });
    expect(notTradeable.status).toBe(400);
    expect(notTradeable.body.error).toBe("not_tradeable");

    // The fast client-side check in updateOffer only validates the catalog; the real re-check that you
    // actually own what you offered happens at confirm time inside execute_trade.
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(a.auth)
      .send({ items: [{ itemId: "seashell", quantity: 4 }], coins: 0 })
      .expect(200);
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(b.auth)
      .send({ items: [], coins: 0 })
      .expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(a.auth).send({ ready: true }).expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(b.auth).send({ ready: true }).expect(200);
    const confirmed = await request(app).post(`/api/trades/${tradeId}/confirm`).set(a.auth);
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error).toBe("insufficient_items");
  });

  it("cancelling closes the trade for good", async () => {
    const a = await makeUser(server.url, handle("cancela"));
    const b = await makeUser(server.url, handle("cancelb"));
    await befriend(a, b);
    const tradeId = await openTrade(a, b);
    const cancelled = await request(app).post(`/api/trades/${tradeId}/cancel`).set(a.auth).expect(200);
    expect(cancelled.body.status).toBe("cancelled");
    const reopened = await request(app).post("/api/trades").set(a.auth).send({ userId: b.id }).expect(200);
    expect(reopened.body.id).not.toBe(tradeId); // the old one is dead; opening again makes a new one
  });

  it("enforces a cooldown between trades right after one completes", async () => {
    const a = await makeUser(server.url, handle("coola"));
    const b = await makeUser(server.url, handle("coolb"));
    await befriend(a, b);
    const tradeId = await openTrade(a, b);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(a.auth).send({ ready: true }).expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(b.auth).send({ ready: true }).expect(200);
    await request(app).post(`/api/trades/${tradeId}/confirm`).set(a.auth).expect(200);

    const tooSoon = await request(app).post("/api/trades").set(a.auth).send({ userId: b.id });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toBe("trade_cooldown");
  });

  /**
   * The named done-criterion for this phase: killing the server mid-trade must leave both inventories
   * and both wallets exactly as they were. `execute_trade` locks every row it will touch and only then
   * (via a test-only debug-sleep parameter that only this test's own direct connection ever passes) pauses,
   * giving us a window to terminate the Postgres backend running it — simulating a server crash mid-transaction.
   */
  it("is atomic: killing the connection mid-trade leaves both sides completely unchanged", async () => {
    const a = await makeUser(server.url, handle("killa"));
    const b = await makeUser(server.url, handle("killb"));
    await befriend(a, b);
    await grantItem(social.sql, a.id, "seashell", 3, true);
    await giveCoins(social.sql, a.id, 40);
    await grantItem(social.sql, b.id, "koi_sticker", 3, true);
    await giveCoins(social.sql, b.id, 25);

    const tradeId = await openTrade(a, b);
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(a.auth)
      .send({ items: [{ itemId: "seashell", quantity: 3 }], coins: 40 })
      .expect(200);
    await request(app)
      .put(`/api/trades/${tradeId}/offer`)
      .set(b.auth)
      .send({ items: [{ itemId: "koi_sticker", quantity: 3 }], coins: 25 })
      .expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(a.auth).send({ ready: true }).expect(200);
    await request(app).post(`/api/trades/${tradeId}/ready`).set(b.auth).send({ ready: true }).expect(200);

    const before = { a: await balanceAndInventory(a.id), b: await balanceAndInventory(b.id) };

    const solo = soloSql();
    const killer = rawSql();
    try {
      const [row] = await solo<{ pid: number }[]>`select pg_backend_pid() as pid`;
      const pid = row!.pid;
      // Never awaited before the kill: this is the whole point of the test.
      const running = solo`select * from public.execute_trade(${tradeId}::uuid, 3000)`;
      await new Promise((r) => setTimeout(r, 400)); // well inside the 3 s sleep, after the row locks are taken
      await killer`select pg_terminate_backend(${pid})`;
      await expect(running).rejects.toThrow();
    } finally {
      // Both connections are already broken (one deliberately killed); don't wait forever to close them.
      await solo.end({ timeout: 1 });
      await killer.end({ timeout: 1 });
    }

    // Nothing moved: Postgres rolled the whole transaction back when the backend died.
    const after = { a: await balanceAndInventory(a.id), b: await balanceAndInventory(b.id) };
    expect(after).toEqual(before);
    const trade = (await request(app).get(`/api/trades/${tradeId}`).set(a.auth).expect(200)).body;
    expect(trade.status).toBe("open");

    // And the trade still works normally afterwards — confirming for real completes it.
    const done = await request(app).post(`/api/trades/${tradeId}/confirm`).set(a.auth).expect(200);
    expect(done.body.status).toBe("completed");
    const finalA = await balanceAndInventory(a.id);
    expect(finalA.balance).toBe(25); // 40 - 40 + 25
  });
});
