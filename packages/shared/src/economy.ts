import { z } from "zod";
import type { PublicProfile } from "./social";

/**
 * Homes, inventory, coins, shops, letters and trading (PROMPT.md Section 9 and 6.1). Item
 * *definitions* live in the catalog (./items.ts, loaded from packages/shared/items/*.json); this
 * file is the shapes for what players actually own and do with them.
 */

// ---------- Inventory & wallet ----------

export interface InventoryEntry {
  /** The row id (stable even for stackable items, so the UI can key on it across quantity changes). */
  id: string;
  itemId: string;
  quantity: number;
  acquiredAt: string;
}

export interface Wallet {
  balance: number;
}

export const COIN_LEDGER_REASONS = [
  "daily_gift",
  "shop_purchase",
  "shop_sale",
  "trade",
  "letter_sent",
  "letter_claimed",
  "admin",
] as const;
export type CoinLedgerReason = (typeof COIN_LEDGER_REASONS)[number];

export interface CoinLedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: CoinLedgerReason;
  refId: string | null;
  createdAt: string;
}

/** A stack of items offered in a trade or attached to a letter: at most 8 distinct item ids. */
export const itemStackSchema = z
  .array(
    z.object({ itemId: z.string().min(1).max(64), quantity: z.number().int().positive().max(9999) }).strict(),
  )
  .max(8)
  .refine(
    (items) => new Set(items.map((i) => i.itemId)).size === items.length,
    "Each item can only be listed once.",
  );
export type ItemStack = z.infer<typeof itemStackSchema>;

export const idempotencyKeySchema = z.string().uuid();

// ---------- Shop ----------

export const buyItemSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    quantity: z.number().int().positive().max(99).default(1),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const sellItemSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    quantity: z.number().int().positive().max(9999).default(1),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export interface DailyGiftResult {
  /** False if today's gift was already claimed (this call granted nothing new). */
  claimed: boolean;
  coins: number;
  itemId: string | null;
  balance: number;
  /** Flavor only — see PROMPT.md Section 9.2: missing a day never resets or punishes this. */
  claimCount: number;
  nextAvailableAt: string;
}

// ---------- Homes ----------

export const HOME_ACCESS_LEVELS = ["friends", "invite", "closed"] as const;
export type HomeAccess = (typeof HOME_ACCESS_LEVELS)[number];
export const HOME_ACCESS_LABELS: Record<HomeAccess, string> = {
  friends: "Open to friends",
  invite: "Invite only",
  closed: "Closed",
};

export const setHomeAccessSchema = z.object({ access: z.enum(HOME_ACCESS_LEVELS) }).strict();
export const homeGuestSchema = z.object({ userId: z.string().uuid() }).strict();

export interface HomeSummary {
  ownerId: string;
  ownerHandle: string;
  access: HomeAccess;
  /** Only present when you're the owner. */
  guests?: PublicProfile[];
}

/** Where furniture can be placed. Kept small and fixed for v1 (no custom room shapes yet). */
export const HOME_GRID_W = 10;
export const HOME_GRID_H = 8;

export const placeFurnitureSchema = z
  .object({
    itemId: z.string().min(1).max(64),
    x: z
      .number()
      .int()
      .min(0)
      .max(HOME_GRID_W - 1),
    y: z
      .number()
      .int()
      .min(0)
      .max(HOME_GRID_H - 1),
  })
  .strict();

export interface FurniturePlacement {
  id: string;
  itemId: string;
  x: number;
  y: number;
}

// ---------- Letters ----------

export const LETTER_SUBJECT_MAX = 60;
export const LETTER_BODY_MAX = 1000;

export const sendLetterSchema = z
  .object({
    toUserId: z.string().uuid(),
    subject: z.string().trim().max(LETTER_SUBJECT_MAX).default(""),
    body: z.string().trim().min(1, "Write something first.").max(LETTER_BODY_MAX),
    stationeryId: z.string().min(1).max(64).default("plain_paper"),
    items: itemStackSchema.default([]),
    coins: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
export type SendLetterRequest = z.infer<typeof sendLetterSchema>;

export interface Letter {
  id: string;
  /** Null if the sender's account has since been deleted. */
  fromUserId: string | null;
  fromProfile: PublicProfile | null;
  toUserId: string;
  subject: string;
  body: string;
  stationeryId: string;
  coins: number;
  items: ItemStack;
  sentAt: string;
  readAt: string | null;
  claimedAt: string | null;
}

// ---------- Trading ----------

export const TRADE_MAX_ITEMS = 8;
/** Seconds you must wait before opening another trade with the same person. */
export const TRADE_COOLDOWN_SECONDS = 10;

export const updateTradeOfferSchema = z
  .object({ items: itemStackSchema, coins: z.number().int().min(0).max(1_000_000) })
  .strict();
export const setTradeReadySchema = z.object({ ready: z.boolean() }).strict();

export type TradeStatus = "open" | "completed" | "cancelled";

export interface TradeSide {
  userId: string;
  profile: PublicProfile | null;
  items: ItemStack;
  coins: number;
  ready: boolean;
}

export interface TradeState {
  id: string;
  status: TradeStatus;
  a: TradeSide;
  b: TradeSide;
  createdAt: string;
  completedAt: string | null;
}

export interface TradeHistoryEntry {
  id: string;
  other: PublicProfile | null;
  youGave: ItemStack;
  youGaveCoins: number;
  youGot: ItemStack;
  youGotCoins: number;
  completedAt: string;
}
