import { describe, expect, it } from "vitest";
import {
  HOME_GRID_H,
  HOME_GRID_W,
  buyItemSchema,
  itemStackSchema,
  placeFurnitureSchema,
  sendLetterSchema,
  setHomeAccessSchema,
  updateTradeOfferSchema,
} from "./economy";

describe("item stacks (trade offers, letter attachments)", () => {
  it("allows up to 8 distinct items", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ itemId: `item_${i}`, quantity: 1 }));
    expect(itemStackSchema.safeParse(items).success).toBe(true);
    expect(itemStackSchema.safeParse([...items, { itemId: "item_9", quantity: 1 }]).success).toBe(false);
  });

  it("rejects the same item id twice", () => {
    const res = itemStackSchema.safeParse([
      { itemId: "seashell", quantity: 1 },
      { itemId: "seashell", quantity: 2 },
    ]);
    expect(res.success).toBe(false);
  });

  it("rejects zero or negative quantities", () => {
    expect(itemStackSchema.safeParse([{ itemId: "seashell", quantity: 0 }]).success).toBe(false);
    expect(itemStackSchema.safeParse([{ itemId: "seashell", quantity: -1 }]).success).toBe(false);
  });
});

describe("shop and homes", () => {
  it("requires a real idempotency key to buy", () => {
    expect(
      buyItemSchema.safeParse({ itemId: "iced_tea", quantity: 2, idempotencyKey: crypto.randomUUID() })
        .success,
    ).toBe(true);
    expect(
      buyItemSchema.safeParse({ itemId: "iced_tea", quantity: 2, idempotencyKey: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("only accepts the three access levels", () => {
    expect(setHomeAccessSchema.safeParse({ access: "invite" }).success).toBe(true);
    expect(setHomeAccessSchema.safeParse({ access: "public" }).success).toBe(false);
  });

  it("keeps furniture placement inside the home grid", () => {
    expect(placeFurnitureSchema.safeParse({ itemId: "wooden_chair", x: 0, y: 0 }).success).toBe(true);
    expect(
      placeFurnitureSchema.safeParse({ itemId: "wooden_chair", x: HOME_GRID_W - 1, y: HOME_GRID_H - 1 })
        .success,
    ).toBe(true);
    expect(placeFurnitureSchema.safeParse({ itemId: "wooden_chair", x: HOME_GRID_W, y: 0 }).success).toBe(
      false,
    );
    expect(placeFurnitureSchema.safeParse({ itemId: "wooden_chair", x: -1, y: 0 }).success).toBe(false);
  });
});

describe("letters", () => {
  it("needs a body but not a subject, and defaults to plain paper", () => {
    const parsed = sendLetterSchema.parse({ toUserId: crypto.randomUUID(), body: "Hi there!" });
    expect(parsed.subject).toBe("");
    expect(parsed.stationeryId).toBe("plain_paper");
    expect(parsed.items).toEqual([]);
    expect(parsed.coins).toBe(0);
  });

  it("rejects an empty body", () => {
    expect(sendLetterSchema.safeParse({ toUserId: crypto.randomUUID(), body: "   " }).success).toBe(false);
  });
});

describe("trade offers", () => {
  it("caps coins at a sane maximum and rejects negative coins", () => {
    expect(updateTradeOfferSchema.safeParse({ items: [], coins: 0 }).success).toBe(true);
    expect(updateTradeOfferSchema.safeParse({ items: [], coins: -5 }).success).toBe(false);
    expect(updateTradeOfferSchema.safeParse({ items: [], coins: 1_000_001 }).success).toBe(false);
  });
});
