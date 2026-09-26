import { describe, expect, it } from "vitest";
import { isTinyFontText, measureTiny, tinyPixels } from "./tinyFont";

describe("tiny font", () => {
  it("covers every character a handle can contain", () => {
    expect(isTinyFontText("abcdefghijklmnopqrstuvwxyz0123456789_")).toBe(true);
    expect(isTinyFontText("Pixel Pal!")).toBe(true);
    expect(isTinyFontText("Zoë")).toBe(false);
  });
  it("measures 4px per letter minus the trailing gap", () => {
    expect(measureTiny("abc")).toBe(11);
    expect(measureTiny("a b")).toBe(9);
  });
  it("draws distinct glyphs", () => {
    const shapes = new Set(
      "abcdefghijklmnopqrstuvwxyz0123456789".split("").map((c) => JSON.stringify(tinyPixels(c))),
    );
    // o/0 and a few pairs are allowed to be close, but every glyph must be unique.
    expect(shapes.size).toBe(36);
  });
});
