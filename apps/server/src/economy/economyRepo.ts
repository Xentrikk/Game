import {
  ITEM_DEFINITIONS,
  getItemDefinition,
  requireItemDefinition,
  type CoinLedgerEntry,
  type CoinLedgerReason,
  type DailyGiftResult,
  type InventoryEntry,
  type ItemRarity,
} from "@hearth/shared";
import type postgres from "postgres";
import type { Sql } from "../db";
import { EconomyError, mapEconomyPgError } from "./errors";

/** A `sql` handed to `sql.begin()` callback: same queries, no `.begin`/`.end` of its own. */
type Tx = postgres.TransactionSql;

interface InventoryRow {
  id: string;
  item_id: string;
  quantity: number;
  acquired_at: Date;
}

function toInventory(r: InventoryRow): InventoryEntry {
  return { id: r.id, itemId: r.item_id, quantity: r.quantity, acquiredAt: r.acquired_at.toISOString() };
}

/** Coin weight per rarity for the daily gift's occasional collectible drop: common items are likelier. */
const RARITY_WEIGHT: Record<ItemRarity, number> = { common: 3, uncommon: 2, rare: 1 };
const DAILY_GIFT_COINS = 50;
/** One in five daily gifts also includes a random collectible. */
const DAILY_GIFT_ITEM_CHANCE = 0.2;
const COLLECTIBLES = [...ITEM_DEFINITIONS.values()].filter((i) => i.category === "collectibles");

/** Wallet, inventory, the shop and the daily gift. Item definitions come from the shared catalog. */
export class EconomyRepo {
  constructor(
    private sql: Sql,
    private random: () => number = Math.random,
  ) {}

  async wallet(userId: string): Promise<{ balance: number }> {
    const [row] = await this.sql<
      { balance: string }[]
    >`select balance from public.wallets where user_id = ${userId}`;
    return { balance: row ? Number(row.balance) : 0 };
  }

  async ledger(userId: string, limit = 50): Promise<CoinLedgerEntry[]> {
    const rows = await this.sql<
      {
        id: string;
        delta: string;
        balance_after: string;
        reason: CoinLedgerReason;
        ref_id: string | null;
        created_at: Date;
      }[]
    >`select id, delta, balance_after, reason, ref_id, created_at from public.coin_ledger
      where user_id = ${userId} order by created_at desc limit ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      delta: Number(r.delta),
      balanceAfter: Number(r.balance_after),
      reason: r.reason,
      refId: r.ref_id,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async inventory(userId: string): Promise<InventoryEntry[]> {
    const rows = await this.sql<InventoryRow[]>`
      select id, item_id, quantity, acquired_at from public.inventory_items
      where owner_id = ${userId} order by acquired_at`;
    return rows.map(toInventory);
  }

  /** How much of `itemId` a user currently owns, across every row. */
  async quantityOwned(userId: string, itemId: string): Promise<number> {
    const [row] = await this.sql<{ qty: string }[]>`
      select coalesce(sum(quantity), 0) as qty from public.inventory_items where owner_id = ${userId} and item_id = ${itemId}`;
    return Number(row?.qty ?? 0);
  }

  /** Claims a client-generated idempotency key inside the given transaction. False means it was already used. */
  async claimKey(tx: Tx, userId: string, key: string): Promise<boolean> {
    const rows = await tx`
      insert into public.economy_idempotency (user_id, key) values (${userId}, ${key}) on conflict do nothing returning 1`;
    return rows.length > 0;
  }

  async buyItem(userId: string, itemId: string, quantity: number, idempotencyKey: string) {
    const def = requireItemDefinition(itemId);
    if (!def.shop || def.price === undefined) throw new EconomyError("not_for_sale");
    const total = def.price * quantity;
    return this.sql.begin(async (tx) => {
      if (!(await this.claimKey(tx, userId, idempotencyKey))) return this.currentState(tx, userId);
      try {
        if (total > 0) await tx`select public.adjust_coins(${userId}, ${-total}, 'shop_purchase', null)`;
        await tx`select public.grant_item(${userId}, ${itemId}, ${quantity}, ${def.stackable})`;
      } catch (e) {
        mapEconomyPgError(e);
      }
      return this.currentState(tx, userId);
    });
  }

  async sellItem(userId: string, itemId: string, quantity: number, idempotencyKey: string) {
    const def = requireItemDefinition(itemId);
    if (def.sellPrice === undefined) throw new EconomyError("not_sellable");
    const total = def.sellPrice * quantity;
    return this.sql.begin(async (tx) => {
      if (!(await this.claimKey(tx, userId, idempotencyKey))) return this.currentState(tx, userId);
      try {
        await tx`select public.remove_items(${userId}, ${itemId}, ${quantity})`;
        if (total > 0) await tx`select public.adjust_coins(${userId}, ${total}, 'shop_sale', null)`;
      } catch (e) {
        mapEconomyPgError(e);
      }
      return this.currentState(tx, userId);
    });
  }

  private async currentState(tx: Tx, userId: string) {
    const [balRow] = await tx<
      { balance: string }[]
    >`select balance from public.wallets where user_id = ${userId}`;
    const invRows = await tx<InventoryRow[]>`
      select id, item_id, quantity, acquired_at from public.inventory_items where owner_id = ${userId} order by acquired_at`;
    return { balance: Number(balRow?.balance ?? 0), inventory: invRows.map(toInventory) };
  }

  /** Picks a random collectible, common ones more often. */
  private randomCollectible(): string | null {
    const totalWeight = COLLECTIBLES.reduce((n, o) => n + RARITY_WEIGHT[o.rarity], 0);
    let roll = this.random() * totalWeight;
    for (const o of COLLECTIBLES) {
      roll -= RARITY_WEIGHT[o.rarity];
      if (roll <= 0) return o.id;
    }
    return COLLECTIBLES[0]?.id ?? null;
  }

  /** Grants the daily gift if it hasn't been claimed yet today (UTC). Never punishes a missed day. */
  async claimDailyGift(userId: string): Promise<DailyGiftResult> {
    const grantItem = this.random() < DAILY_GIFT_ITEM_CHANCE ? this.randomCollectible() : null;
    const def = grantItem ? getItemDefinition(grantItem) : undefined;
    const [row] = await this.sql<{ claimed: boolean; balance: string; claim_count: number }[]>`
      select * from public.claim_daily_gift(${userId}, ${DAILY_GIFT_COINS}, ${grantItem}, ${def?.stackable ?? false})`;
    const now = new Date();
    const nextAvailableAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return {
      claimed: row!.claimed,
      coins: row!.claimed ? DAILY_GIFT_COINS : 0,
      itemId: row!.claimed ? grantItem : null,
      balance: Number(row!.balance),
      claimCount: row!.claim_count,
      nextAvailableAt: nextAvailableAt.toISOString(),
    };
  }
}
