import { requireItemDefinition, TRADE_COOLDOWN_SECONDS, type ItemStack } from "@hearth/shared";
import type { Sql } from "../db";
import { EconomyError, mapEconomyPgError } from "./errors";

interface TradeRow {
  id: string;
  user_a: string;
  user_b: string;
  status: "open" | "completed" | "cancelled";
  a_coins: string;
  b_coins: string;
  a_ready: boolean;
  b_ready: boolean;
  created_at: Date;
  completed_at: Date | null;
}
interface TradeItemRow {
  trade_id: string;
  side: "a" | "b";
  item_id: string;
  quantity: number;
}

export interface TradeSideRaw {
  userId: string;
  items: ItemStack;
  coins: number;
  ready: boolean;
}
export interface TradeRaw {
  id: string;
  status: "open" | "completed" | "cancelled";
  a: TradeSideRaw;
  b: TradeSideRaw;
  createdAt: string;
  completedAt: string | null;
}

function toTrade(row: TradeRow, items: TradeItemRow[]): TradeRaw {
  const side = (s: "a" | "b"): TradeSideRaw => ({
    userId: s === "a" ? row.user_a : row.user_b,
    items: items.filter((i) => i.side === s).map((i) => ({ itemId: i.item_id, quantity: i.quantity })),
    coins: Number(s === "a" ? row.a_coins : row.b_coins),
    ready: s === "a" ? row.a_ready : row.b_ready,
  });
  return {
    id: row.id,
    status: row.status,
    a: side("a"),
    b: side("b"),
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

/**
 * Friend-to-friend trading (PROMPT.md Section 9.3). Every mutation goes through a SQL function in the
 * Phase 4 migration that locks the row(s) it touches, so two requests racing on the same trade can never
 * both succeed, and changing an offer always resets both sides' Ready.
 */
export class TradeRepo {
  constructor(private sql: Sql) {}

  private async itemsFor(tradeId: string): Promise<TradeItemRow[]> {
    return this.sql<TradeItemRow[]>`
      select trade_id, side, item_id, quantity from public.trade_items where trade_id = ${tradeId}`;
  }

  async get(tradeId: string): Promise<TradeRaw | null> {
    const [row] = await this.sql<TradeRow[]>`select * from public.trades where id = ${tradeId}`;
    if (!row) return null;
    return toTrade(row, await this.itemsFor(tradeId));
  }

  /** The open trade between two people, if there is one. */
  async openBetween(a: string, b: string): Promise<TradeRaw | null> {
    const [row] = await this.sql<TradeRow[]>`
      select * from public.trades where status = 'open'
        and least(user_a, user_b) = least(${a}::uuid, ${b}::uuid)
        and greatest(user_a, user_b) = greatest(${a}::uuid, ${b}::uuid)`;
    if (!row) return null;
    return toTrade(row, await this.itemsFor(row.id));
  }

  /** Opens a trade with a friend, or returns the one already open. Enforces the cooldown after a trade completes. */
  async open(a: string, b: string): Promise<TradeRaw> {
    try {
      const [row] = await this.sql<TradeRow[]>`select * from public.open_trade(${a}, ${b})`;
      return toTrade(row!, await this.itemsFor(row!.id));
    } catch (e) {
      mapEconomyPgError(e);
    }
  }

  /** Validates every offered item against the catalog before it's even written (a fast, friendly check;
   * `execute_trade` re-checks ownership and locks the rows for real at confirm time). */
  private validateOffer(items: ItemStack) {
    for (const item of items) {
      const def = requireItemDefinition(item.itemId);
      if (!def.tradeable) throw new EconomyError("not_tradeable");
      if (item.quantity > def.maxStack) throw new EconomyError("exceeds_max_stack");
    }
  }

  async updateOffer(tradeId: string, userId: string, items: ItemStack, coins: number): Promise<TradeRaw> {
    this.validateOffer(items);
    const payload = items.map((i) => ({ ...i, stackable: requireItemDefinition(i.itemId).stackable }));
    try {
      const [row] = await this.sql<TradeRow[]>`
        select * from public.update_trade_offer(${tradeId}, ${userId}, ${this.sql.json(payload)}, ${coins})`;
      return toTrade(row!, await this.itemsFor(row!.id));
    } catch (e) {
      mapEconomyPgError(e);
    }
  }

  async setReady(tradeId: string, userId: string, ready: boolean): Promise<TradeRaw> {
    try {
      const [row] = await this.sql<
        TradeRow[]
      >`select * from public.set_trade_ready(${tradeId}, ${userId}, ${ready})`;
      return toTrade(row!, await this.itemsFor(row!.id));
    } catch (e) {
      mapEconomyPgError(e);
    }
  }

  async cancel(tradeId: string, userId: string): Promise<TradeRaw> {
    try {
      const [row] = await this.sql<TradeRow[]>`select * from public.cancel_trade(${tradeId}, ${userId})`;
      return toTrade(row!, await this.itemsFor(row!.id));
    } catch (e) {
      mapEconomyPgError(e);
    }
  }

  /**
   * Runs the atomic swap. This never accepts a debug-sleep parameter — only the test suite's own SQL
   * connection can pass one, directly, never through this method (see the migration's `execute_trade`).
   */
  async confirm(tradeId: string): Promise<TradeRaw> {
    try {
      const [row] = await this.sql<TradeRow[]>`select * from public.execute_trade(${tradeId})`;
      return toTrade(row!, await this.itemsFor(row!.id));
    } catch (e) {
      mapEconomyPgError(e);
    }
  }

  /** Completed trades a user was part of, most recent first. */
  async history(userId: string, limit = 20): Promise<{ trade: TradeRaw; otherUserId: string }[]> {
    const rows = await this.sql<TradeRow[]>`
      select * from public.trades where status = 'completed' and ${userId} in (user_a, user_b)
      order by completed_at desc limit ${limit}`;
    const items = await this.sql<TradeItemRow[]>`
      select trade_id, side, item_id, quantity from public.trade_items where trade_id = any(${rows.map((r) => r.id)}::uuid[])`;
    return rows.map((row) => ({
      trade: toTrade(
        row,
        items.filter((i) => i.trade_id === row.id),
      ),
      otherUserId: row.user_a === userId ? row.user_b : row.user_a,
    }));
  }

  static readonly cooldownSeconds = TRADE_COOLDOWN_SECONDS;
}
