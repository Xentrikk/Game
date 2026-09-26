import { describe, expect, it } from "vitest";
import {
  ACCESSORIES,
  TOPS,
  appearanceSchema,
  changeGarment,
  checkAge,
  containsProfanity,
  defaultAppearance,
  isE164,
  normalizePhone,
  profileDetailsSchema,
  randomAppearance,
  validateHandle,
} from "./index";

describe("age gate", () => {
  it("accepts someone exactly 13 today", () => {
    expect(checkAge("2013-09-26", "2026-09-26")).toEqual({ ok: true, age: 13 });
  });
  it("rejects someone who turns 13 tomorrow", () => {
    expect(checkAge("2013-09-27", "2026-09-26")).toEqual({ ok: false, reason: "too_young" });
  });
  it("handles Feb 29 birthdays", () => {
    expect(checkAge("2012-02-29", "2025-02-28")).toEqual({ ok: false, reason: "too_young" });
    expect(checkAge("2012-02-29", "2025-03-01")).toEqual({ ok: true, age: 13 });
  });
  it("rejects impossible or future dates", () => {
    expect(checkAge("2010-02-30", "2026-09-26").ok).toBe(false);
    expect(checkAge("2030-01-01", "2026-09-26")).toEqual({ ok: false, reason: "invalid" });
    expect(checkAge("1850-01-01", "2026-09-26")).toEqual({ ok: false, reason: "invalid" });
    expect(checkAge("not-a-date", "2026-09-26")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("handles", () => {
  it("lowercases and accepts valid handles", () => {
    expect(validateHandle("Pixel_Sam")).toEqual({ ok: true, handle: "pixel_sam" });
  });
  it("enforces length and characters", () => {
    expect(validateHandle("ab")).toEqual({ ok: false, problem: "length" });
    expect(validateHandle("a".repeat(17))).toEqual({ ok: false, problem: "length" });
    expect(validateHandle("hi there")).toEqual({ ok: false, problem: "characters" });
    expect(validateHandle("émile")).toEqual({ ok: false, problem: "characters" });
  });
  it("blocks reserved names and prefixes", () => {
    expect(validateHandle("admin")).toEqual({ ok: false, problem: "reserved" });
    expect(validateHandle("Hearth_Team")).toEqual({ ok: false, problem: "reserved" });
    expect(validateHandle("mod_bob")).toEqual({ ok: false, problem: "reserved" });
  });
  it("blocks profanity including leetspeak", () => {
    expect(validateHandle("sh1tlord")).toEqual({ ok: false, problem: "inappropriate" });
    expect(validateHandle("fuuuck")).toEqual({ ok: false, problem: "inappropriate" });
  });
});

describe("profanity filter", () => {
  it("does not flag innocent words that contain short bad words", () => {
    for (const ok of ["classic", "grape", "peacock", "scunthorpe", "assassin", "cocktail", "Dickens"]) {
      expect(containsProfanity(ok), ok).toBe(false);
    }
  });
  it("flags whole-word and substring profanity", () => {
    expect(containsProfanity("you are an ass")).toBe(true);
    expect(containsProfanity("bullshit")).toBe(true);
  });
});

describe("phone", () => {
  it("normalizes and validates E.164", () => {
    expect(normalizePhone("+1 (555) 555-0100")).toBe("+15555550100");
    expect(isE164("+15555550100")).toBe(true);
    expect(isE164("5555550100")).toBe(false);
    expect(isE164("+0123456789")).toBe(false);
  });
});

describe("appearance", () => {
  it("default appearance is valid", () => {
    expect(appearanceSchema.safeParse(defaultAppearance()).success).toBe(true);
  });
  it("random appearances are always valid", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 500; i++) {
      const a = randomAppearance(rand);
      const r = appearanceSchema.safeParse(a);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    }
  });
  it("rejects unknown IDs, bad color counts and extra fields", () => {
    const base = defaultAppearance();
    expect(appearanceSchema.safeParse({ ...base, body: "giant" }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...base, top: { id: "tee", colors: [1, 2, 3] } }).success).toBe(
      false,
    );
    expect(appearanceSchema.safeParse({ ...base, top: { id: "cape", colors: [1, 2] } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...base, skin: 99 }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...base, top: { id: "tee", colors: [1, 99] } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...base, admin: true }).success).toBe(false);
  });
  it("changing garments keeps colors when possible", () => {
    const hoodie = changeGarment(TOPS, { id: "tee", colors: [4, 5] }, "hoodie");
    expect(hoodie).toEqual({ id: "hoodie", colors: [4, 5, 3] });
    const cap = changeGarment(ACCESSORIES, null, "cap");
    expect(cap.colors).toHaveLength(2);
  });
});

describe("profile details", () => {
  it("validates lengths and filters words", () => {
    expect(profileDetailsSchema.safeParse({ displayName: "Sam", pronouns: "", bio: "hi!" }).success).toBe(
      true,
    );
    expect(profileDetailsSchema.safeParse({ displayName: "", pronouns: "", bio: "" }).success).toBe(false);
    expect(
      profileDetailsSchema.safeParse({ displayName: "Sam", pronouns: "", bio: "x".repeat(81) }).success,
    ).toBe(false);
    expect(profileDetailsSchema.safeParse({ displayName: "shithead", pronouns: "", bio: "" }).success).toBe(
      false,
    );
  });
});
