import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATIONERY_ID,
  ITEM_DEFINITIONS,
  SHOPS,
  getItemDefinition,
  isKnownItem,
  itemsInShop,
  requireItemDefinition,
} from "./items";

describe("item catalog", () => {
  it("has at least a few items in every category", () => {
    const counts: Record<string, number> = {};
    for (const item of ITEM_DEFINITIONS.values()) counts[item.category] = (counts[item.category] ?? 0) + 1;
    for (const cat of ["cosmetics", "furniture", "collectibles", "consumables", "stationery"]) {
      expect(counts[cat] ?? 0, cat).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every shop item a price, and every priced item a shop unless it's a free default", () => {
    for (const item of ITEM_DEFINITIONS.values()) {
      if (item.shop) expect(item.price, item.id).toBeDefined();
      if (item.price !== undefined && item.price > 0) expect(item.shop, item.id).toBeDefined();
    }
  });

  it("only gives stackable items a maxStack above 1", () => {
    for (const item of ITEM_DEFINITIONS.values()) {
      if (!item.stackable) expect(item.maxStack, item.id).toBe(1);
      else expect(item.maxStack, item.id).toBeGreaterThan(1);
    }
  });

  it("has at least one non-tradeable item (to test that trades reject it)", () => {
    expect([...ITEM_DEFINITIONS.values()].some((i) => !i.tradeable)).toBe(true);
  });

  it("makes the default stationery free and always available", () => {
    const paper = requireItemDefinition(DEFAULT_STATIONERY_ID);
    expect(paper.category).toBe("stationery");
    expect(paper.price).toBe(0);
  });

  it("looks items up by id, and rejects unknown ids", () => {
    expect(getItemDefinition("nonexistent_item_xyz")).toBeUndefined();
    expect(isKnownItem("nonexistent_item_xyz")).toBe(false);
    expect(() => requireItemDefinition("nonexistent_item_xyz")).toThrow(/Unknown item/);
    const [firstId] = ITEM_DEFINITIONS.keys();
    expect(isKnownItem(firstId!)).toBe(true);
  });

  it("lists each shop's items consistently", () => {
    for (const shop of SHOPS) {
      const items = itemsInShop(shop);
      for (const item of items) expect(item.shop).toBe(shop);
    }
    const allShopItems = SHOPS.flatMap((s) => itemsInShop(s));
    expect(allShopItems.length).toBe([...ITEM_DEFINITIONS.values()].filter((i) => i.shop).length);
  });
});
