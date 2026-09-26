import { describe, expect, it } from "vitest";
import {
  bubbleMs,
  createGroupSchema,
  formatFriendCode,
  maskProfanity,
  normalizeFriendCode,
  sayMessage,
  settingsSchema,
} from "./index";

describe("friend codes", () => {
  it("accepts any spacing, dashes and case, and rejects look-alike characters", () => {
    expect(normalizeFriendCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeFriendCode(" ab cd 23 45 ")).toBe("ABCD2345");
    expect(normalizeFriendCode("ABCD1234")).toBeNull(); // 1 is never used
    expect(normalizeFriendCode("OBCD2345")).toBeNull(); // nor O
    expect(normalizeFriendCode("ABC")).toBeNull();
    expect(formatFriendCode("ABCD2345")).toBe("ABCD-2345");
  });
});

describe("world chat", () => {
  it("masks profane words but keeps the rest", () => {
    expect(maskProfanity("this is shit, honestly")).toBe("this is ***** honestly");
    expect(maskProfanity("classic grape peacock")).toBe("classic grape peacock");
  });
  it("keeps bubbles up for 5 s plus 60 ms per character", () => {
    expect(bubbleMs("")).toBe(5000);
    expect(bubbleMs("hello")).toBe(5300);
  });
  it("limits Say to 200 characters and trims it", () => {
    expect(sayMessage.safeParse({ text: "  hi  " }).data).toEqual({ text: "hi" });
    expect(sayMessage.safeParse({ text: "x".repeat(201) }).success).toBe(false);
    expect(sayMessage.safeParse({ text: "   " }).success).toBe(false);
  });
});

describe("settings", () => {
  it("fills in safe defaults", () => {
    expect(settingsSchema.parse({})).toEqual({
      readReceipts: true,
      presence: "auto",
      shareLocation: true,
      notifications: { dm: true, group: true, friendRequest: true },
      quietHours: { enabled: false, start: "22:00", end: "07:00" },
      timeZone: "UTC",
    });
  });
});

describe("groups", () => {
  it("need a clean name and at least one other member", () => {
    const id = crypto.randomUUID();
    expect(createGroupSchema.safeParse({ name: "Pals", icon: "star", memberIds: [id] }).success).toBe(true);
    expect(createGroupSchema.safeParse({ name: "Pals", icon: "star", memberIds: [] }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: "shit club", icon: "star", memberIds: [id] }).success).toBe(
      false,
    );
    expect(createGroupSchema.safeParse({ name: "Pals", icon: "rocket", memberIds: [id] }).success).toBe(
      false,
    );
  });
});
