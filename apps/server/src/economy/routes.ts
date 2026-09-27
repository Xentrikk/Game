import {
  DEFAULT_STATIONERY_ID,
  SHOPS,
  buyItemSchema,
  homeGuestSchema,
  itemsInShop,
  placeFurnitureSchema,
  requireItemDefinition,
  sellItemSchema,
  sendLetterSchema,
  setHomeAccessSchema,
  setTradeReadySchema,
  updateTradeOfferSchema,
  userIdSchema,
  type HomeSummary,
  type Letter,
  type PublicProfile,
  type ServerEvent,
  type TradeHistoryEntry,
  type TradeState,
} from "@hearth/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { currentUser, requireUser, type TokenVerifier } from "../auth";
import { userChannel, type EventBus } from "../bus";
import { HttpError } from "../errors";
import { parse } from "../http";
import type { SocialRepo } from "../social/socialRepo";
import type { PresenceService } from "../social/presence";
import type { PushService } from "../social/push";
import { EconomyError } from "./errors";
import type { EconomyRepo } from "./economyRepo";
import type { HomeRepo } from "./homeRepo";
import type { LetterRow, LetterRepo } from "./letterRepo";
import type { TradeRaw, TradeRepo } from "./tradeRepo";

export interface EconomyDeps {
  economy: EconomyRepo;
  homes: HomeRepo;
  letters: LetterRepo;
  trades: TradeRepo;
  social: SocialRepo;
  presence: PresenceService;
  push: PushService;
  bus: EventBus;
  verifyToken: TokenVerifier;
}

const ECONOMY_ERROR_MESSAGES: Record<EconomyError["code"], [number, string]> = {
  unknown_item: [404, "That item doesn't exist."],
  not_for_sale: [400, "That isn't sold in any shop."],
  not_sellable: [400, "The Trading Post won't buy that."],
  not_tradeable: [400, "That item can't be traded or gifted."],
  exceeds_max_stack: [400, "That's more than you can offer of that item."],
  insufficient_coins: [409, "Not enough coins."],
  insufficient_items: [409, "You don't have that many to give."],
  trade_cooldown: [429, "You just traded with them. Try again in a few seconds."],
  trade_not_open: [409, "This trade isn't open anymore."],
  trade_not_found: [404, "That trade isn't there."],
  not_a_participant: [403, "That's not your trade."],
  not_both_ready: [409, "Both people need to be ready first."],
  tile_taken: [409, "Something's already there."],
  not_furniture: [400, "That isn't furniture."],
  letter_not_found: [404, "That letter isn't there."],
  stationery_not_owned: [400, "You don't own that stationery."],
};

function economyError(e: unknown): never {
  if (e instanceof EconomyError) {
    const [status, message] = ECONOMY_ERROR_MESSAGES[e.code];
    throw new HttpError(status, e.code, message);
  }
  throw e;
}

/** Homes, inventory, coins, the shop, letters and trading (PROMPT.md Sections 6.1 and 9). */
export function economyRoutes(d: EconomyDeps): Router {
  const r = Router();
  const authed = requireUser(d.verifyToken);
  const tell = (userId: string, event: ServerEvent) => d.bus.publish(userChannel(userId), event);
  const userIdParam = (req: Request, name = "userId") => parse(z.string().uuid(), req.params[name]);

  async function requireFriend(me: string, other: string) {
    if (!(await d.social.areFriends(me, other)))
      throw new HttpError(403, "not_friends", "You can only do that with friends.");
  }

  // ---------- Inventory & wallet ----------

  r.get("/api/inventory", authed, async (req, res) => {
    res.json({ inventory: await d.economy.inventory(currentUser(req).id) });
  });

  r.get("/api/wallet", authed, async (req, res) => {
    res.json(await d.economy.wallet(currentUser(req).id));
  });

  r.get("/api/wallet/ledger", authed, async (req, res) => {
    res.json({ entries: await d.economy.ledger(currentUser(req).id) });
  });

  r.post("/api/daily-gift/claim", authed, async (req, res) => {
    res.json(await d.economy.claimDailyGift(currentUser(req).id));
  });

  // ---------- Shop ----------

  r.get("/api/shop/:shopId", (req, res) => {
    const shopId = parse(z.enum(SHOPS), req.params.shopId);
    res.json({ items: itemsInShop(shopId) });
  });

  r.post("/api/shop/buy", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(buyItemSchema, req.body);
    try {
      requireItemDefinition(body.itemId);
      const state = await d.economy.buyItem(me, body.itemId, body.quantity, body.idempotencyKey);
      res.json(state);
    } catch (e) {
      economyError(e);
    }
  });

  r.post("/api/shop/sell", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(sellItemSchema, req.body);
    try {
      requireItemDefinition(body.itemId);
      const state = await d.economy.sellItem(me, body.itemId, body.quantity, body.idempotencyKey);
      res.json(state);
    } catch (e) {
      economyError(e);
    }
  });

  // ---------- Homes ----------

  async function homeSummary(ownerId: string, viewerId: string): Promise<HomeSummary> {
    const [access, ownerProfile] = await Promise.all([
      d.homes.getAccess(ownerId),
      d.social.profiles([ownerId]),
    ]);
    const summary: HomeSummary = { ownerId, ownerHandle: ownerProfile.get(ownerId)?.handle ?? "", access };
    if (viewerId === ownerId) {
      const guestIds = await d.homes.guestIds(ownerId);
      const guestProfiles = await d.social.profiles(guestIds);
      summary.guests = guestIds.map((id) => guestProfiles.get(id)).filter((p): p is PublicProfile => !!p);
    }
    return summary;
  }

  r.get("/api/homes/:ownerId", authed, async (req, res) => {
    const me = currentUser(req).id;
    const ownerId = userIdParam(req, "ownerId");
    res.json(await homeSummary(ownerId, me));
  });

  r.get("/api/homes/:ownerId/entry", authed, async (req, res) => {
    const me = currentUser(req).id;
    const ownerId = userIdParam(req, "ownerId");
    const [isFriend, isBlocked] = await Promise.all([
      d.social.areFriends(me, ownerId),
      d.social.isBlockedBetween(me, ownerId),
    ]);
    res.json({ canEnter: await d.homes.canEnter(ownerId, me, isFriend, isBlocked) });
  });

  r.put("/api/homes/access", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { access } = parse(setHomeAccessSchema, req.body);
    await d.homes.setAccess(me, access);
    d.bus.publish(`home:${me}`, { ownerId: me });
    res.json(await homeSummary(me, me));
  });

  r.post("/api/homes/guests", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { userId } = parse(homeGuestSchema, req.body);
    await requireFriend(me, userId);
    await d.homes.addGuest(me, userId);
    res.json(await homeSummary(me, me));
  });

  r.delete("/api/homes/guests/:userId", authed, async (req, res) => {
    const me = currentUser(req).id;
    await d.homes.removeGuest(me, userIdParam(req));
    res.json(await homeSummary(me, me));
  });

  async function requireHomeEntry(ownerId: string, visitorId: string) {
    const [isFriend, isBlocked] = await Promise.all([
      d.social.areFriends(visitorId, ownerId),
      d.social.isBlockedBetween(visitorId, ownerId),
    ]);
    if (!(await d.homes.canEnter(ownerId, visitorId, isFriend, isBlocked))) {
      throw new HttpError(403, "cant_enter", "You can't go in there.");
    }
  }

  r.get("/api/homes/:ownerId/furniture", authed, async (req, res) => {
    const me = currentUser(req).id;
    const ownerId = userIdParam(req, "ownerId");
    await requireHomeEntry(ownerId, me);
    res.json({ furniture: await d.homes.furniture(ownerId) });
  });

  r.post("/api/homes/furniture", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(placeFurnitureSchema, req.body);
    try {
      const placed = await d.homes.place(me, body.itemId, body.x, body.y);
      d.bus.publish(`home:${me}`, { ownerId: me });
      res.json(placed);
    } catch (e) {
      economyError(e);
    }
  });

  r.delete("/api/homes/furniture/:id", authed, async (req, res) => {
    const me = currentUser(req).id;
    await d.homes.remove(me, parse(z.string().uuid(), req.params.id));
    d.bus.publish(`home:${me}`, { ownerId: me });
    res.json({ ok: true });
  });

  // ---------- Letters ----------

  async function withSender(letter: LetterRow): Promise<Letter> {
    const fromProfile = letter.fromUserId
      ? ((await d.social.profiles([letter.fromUserId])).get(letter.fromUserId) ?? null)
      : null;
    return { ...letter, fromProfile };
  }

  r.get("/api/letters", authed, async (req, res) => {
    const me = currentUser(req).id;
    const [inbox, mailboxFlag] = await Promise.all([d.letters.inbox(me), d.letters.hasUnclaimed(me)]);
    res.json({ letters: await Promise.all(inbox.map(withSender)), mailboxFlag });
  });

  r.get("/api/letters/sent", authed, async (req, res) => {
    const me = currentUser(req).id;
    const sent = await d.letters.sent(me);
    res.json({ letters: await Promise.all(sent.map(withSender)) });
  });

  r.get("/api/letters/:id", authed, async (req, res) => {
    const me = currentUser(req).id;
    const letter = await d.letters.get(parse(z.string().uuid(), req.params.id));
    if (!letter || (letter.toUserId !== me && letter.fromUserId !== me)) {
      throw new HttpError(404, "not_found", "That letter isn't there.");
    }
    if (letter.toUserId === me) await d.letters.markRead(letter.id, me);
    res.json(
      await withSender(
        letter.toUserId === me ? { ...letter, readAt: letter.readAt ?? new Date().toISOString() } : letter,
      ),
    );
  });

  r.post("/api/letters", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(sendLetterSchema, req.body);
    if (body.toUserId === me) throw new HttpError(400, "self", "You can't send yourself a letter.");
    await requireFriend(me, body.toUserId);
    try {
      const letter = await d.letters.send({
        fromUserId: me,
        toUserId: body.toUserId,
        subject: body.subject,
        body: body.body,
        stationeryId: body.stationeryId ?? DEFAULT_STATIONERY_ID,
        items: body.items,
        coins: body.coins,
      });
      tell(body.toUserId, { type: "letter", letterId: letter.id });
      tell(me, { type: "inventory_changed" });
      if (body.coins > 0) tell(me, { type: "wallet_changed", balance: (await d.economy.wallet(me)).balance });
      const [senderProfile] = (await d.social.profiles([me])).values();
      void d.push.notify(body.toUserId, "letter", {
        title: "A letter arrived!",
        body: `${senderProfile?.displayName ?? "A friend"} sent you a letter.`,
        url: "/?letters",
        tag: "letters",
      });
      res.json(await withSender(letter));
    } catch (e) {
      economyError(e);
    }
  });

  r.post("/api/letters/:id/claim", authed, async (req, res) => {
    const me = currentUser(req).id;
    try {
      const letter = await d.letters.claim(parse(z.string().uuid(), req.params.id), me);
      tell(me, { type: "inventory_changed" });
      tell(me, { type: "wallet_changed", balance: (await d.economy.wallet(me)).balance });
      res.json(await withSender(letter));
    } catch (e) {
      economyError(e);
    }
  });

  // ---------- Trading ----------

  async function tradeState(raw: TradeRaw): Promise<TradeState> {
    const profiles = await d.social.profiles([raw.a.userId, raw.b.userId]);
    return {
      id: raw.id,
      status: raw.status,
      a: { ...raw.a, profile: profiles.get(raw.a.userId) ?? null },
      b: { ...raw.b, profile: profiles.get(raw.b.userId) ?? null },
      createdAt: raw.createdAt,
      completedAt: raw.completedAt,
    };
  }

  function participant(raw: TradeRaw, me: string) {
    if (raw.a.userId !== me && raw.b.userId !== me)
      throw new HttpError(403, "not_a_participant", "That's not your trade.");
  }

  const broadcastTrade = async (raw: TradeRaw) => {
    const state = await tradeState(raw);
    tell(raw.a.userId, { type: "trade_updated", tradeId: raw.id });
    tell(raw.b.userId, { type: "trade_updated", tradeId: raw.id });
    return state;
  };

  r.post("/api/trades", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { userId } = parse(userIdSchema, req.body);
    if (userId === me) throw new HttpError(400, "self", "You can't trade with yourself.");
    await requireFriend(me, userId);
    try {
      const raw = await d.trades.open(me, userId);
      // Tells the other person too, so a trade they didn't start still shows up for them.
      res.json(await broadcastTrade(raw));
    } catch (e) {
      economyError(e);
    }
  });

  r.get("/api/trades/history", authed, async (req, res) => {
    const me = currentUser(req).id;
    const entries = await d.trades.history(me);
    const otherIds = entries.map((e) => e.otherUserId);
    const profiles = await d.social.profiles(otherIds);
    const history: TradeHistoryEntry[] = entries.map(({ trade, otherUserId }) => {
      const mine = trade.a.userId === me ? trade.a : trade.b;
      const theirs = trade.a.userId === me ? trade.b : trade.a;
      return {
        id: trade.id,
        other: profiles.get(otherUserId) ?? null,
        youGave: mine.items,
        youGaveCoins: mine.coins,
        youGot: theirs.items,
        youGotCoins: theirs.coins,
        completedAt: trade.completedAt!,
      };
    });
    res.json({ history });
  });

  r.get("/api/trades/:id", authed, async (req, res) => {
    const me = currentUser(req).id;
    const raw = await d.trades.get(parse(z.string().uuid(), req.params.id));
    if (!raw) throw new HttpError(404, "trade_not_found", "That trade isn't there.");
    participant(raw, me);
    res.json(await tradeState(raw));
  });

  r.put("/api/trades/:id/offer", authed, async (req, res) => {
    const me = currentUser(req).id;
    const body = parse(updateTradeOfferSchema, req.body);
    try {
      const raw = await d.trades.updateOffer(
        parse(z.string().uuid(), req.params.id),
        me,
        body.items,
        body.coins,
      );
      res.json(await broadcastTrade(raw));
    } catch (e) {
      economyError(e);
    }
  });

  r.post("/api/trades/:id/ready", authed, async (req, res) => {
    const me = currentUser(req).id;
    const { ready } = parse(setTradeReadySchema, req.body);
    try {
      const raw = await d.trades.setReady(parse(z.string().uuid(), req.params.id), me, ready);
      res.json(await broadcastTrade(raw));
    } catch (e) {
      economyError(e);
    }
  });

  r.post("/api/trades/:id/cancel", authed, async (req, res) => {
    const me = currentUser(req).id;
    try {
      const raw = await d.trades.cancel(parse(z.string().uuid(), req.params.id), me);
      res.json(await broadcastTrade(raw));
    } catch (e) {
      economyError(e);
    }
  });

  r.post("/api/trades/:id/confirm", authed, async (req, res) => {
    const me = currentUser(req).id;
    const id = parse(z.string().uuid(), req.params.id);
    const before = await d.trades.get(id);
    if (!before) throw new HttpError(404, "trade_not_found", "That trade isn't there.");
    participant(before, me);
    try {
      const raw = await d.trades.confirm(id);
      const state = await broadcastTrade(raw);
      if (raw.status === "completed") {
        for (const userId of [raw.a.userId, raw.b.userId]) {
          tell(userId, { type: "inventory_changed" });
          tell(userId, { type: "wallet_changed", balance: (await d.economy.wallet(userId)).balance });
        }
      }
      res.json(state);
    } catch (e) {
      economyError(e);
    }
  });

  return r;
}
