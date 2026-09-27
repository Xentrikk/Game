import cosmetics from "../items/cosmetics.json" with { type: "json" };
import furniture from "../items/furniture.json" with { type: "json" };
import collectibles from "../items/collectibles.json" with { type: "json" };
import consumables from "../items/consumables.json" with { type: "json" };
import stationery from "../items/stationery.json" with { type: "json" };

/**
 * The item catalog. This is the single source of truth for what items exist and their rules
 * (PROMPT.md Section 9.1) — there is no items table in the database. The server validates every
 * item id a client sends against this catalog before touching inventory rows.
 */
export const ITEM_CATEGORIES = [
  "cosmetics",
  "furniture",
  "collectibles",
  "consumables",
  "stationery",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_RARITIES = ["common", "uncommon", "rare"] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

export const SHOPS = ["cafe", "boutique", "general"] as const;
export type ShopId = (typeof SHOPS)[number];
export const SHOP_NAMES: Record<ShopId, string> = {
  cafe: "Café",
  boutique: "Boutique",
  general: "General Store",
};

export interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: ItemRarity;
  /** Can be given away in a trade or letter. */
  tradeable: boolean;
  stackable: boolean;
  /** Highest quantity one inventory row (or trade/letter offer) may hold. */
  maxStack: number;
  /** Frame name in the generated item icon sheet (apps/client/public/items/items.png). */
  sprite: string;
  description: string;
  /** Buy price at `shop`, in coins. Absent if the item isn't shop-purchasable. */
  price?: number;
  /** What the Trading Post pays to buy it back. Absent if it can't be sold. */
  sellPrice?: number;
  shop?: ShopId;
}

const RAW: ItemDefinition[][] = [
  cosmetics,
  furniture,
  collectibles,
  consumables,
  stationery,
] as ItemDefinition[][];
const ALL: ItemDefinition[] = RAW.flat();

function checkCatalog(items: ItemDefinition[]): Map<string, ItemDefinition> {
  const map = new Map<string, ItemDefinition>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`Duplicate item id "${item.id}" in the catalog`);
    if (!ITEM_CATEGORIES.includes(item.category)) throw new Error(`${item.id}: unknown category`);
    if (!ITEM_RARITIES.includes(item.rarity)) throw new Error(`${item.id}: unknown rarity`);
    if (item.maxStack < 1) throw new Error(`${item.id}: maxStack must be at least 1`);
    if (!item.stackable && item.maxStack !== 1)
      throw new Error(`${item.id}: non-stackable items must have maxStack 1`);
    if (item.shop && !SHOPS.includes(item.shop)) throw new Error(`${item.id}: unknown shop "${item.shop}"`);
    if (item.shop && item.price === undefined) throw new Error(`${item.id}: has a shop but no price`);
    // A price of 0 marks a free default (e.g. plain paper) that isn't sold in any shop.
    if (item.price !== undefined && item.price > 0 && !item.shop)
      throw new Error(`${item.id}: has a price but no shop`);
    map.set(item.id, item);
  }
  return map;
}

/** id → definition. */
export const ITEM_DEFINITIONS: ReadonlyMap<string, ItemDefinition> = checkCatalog(ALL);

export function getItemDefinition(id: string): ItemDefinition | undefined {
  return ITEM_DEFINITIONS.get(id);
}

/** Throws if the id isn't in the catalog. The server uses this to reject unknown item ids outright. */
export function requireItemDefinition(id: string): ItemDefinition {
  const def = ITEM_DEFINITIONS.get(id);
  if (!def) throw new Error(`Unknown item "${id}"`);
  return def;
}

export function itemsInShop(shop: ShopId): ItemDefinition[] {
  return ALL.filter((i) => i.shop === shop);
}

/** Everyone can always use plain paper for letters, whether or not they "own" it. */
export const DEFAULT_STATIONERY_ID = "plain_paper";

export function isKnownItem(id: string): boolean {
  return ITEM_DEFINITIONS.has(id);
}
