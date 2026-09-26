import {
  ACCESSORIES,
  BODIES,
  BOTTOMS,
  EYE_STYLES,
  HAIR_STYLES,
  SHOES,
  TOPS,
  defaultAppearance,
  randomAppearance,
} from "@hearth/shared";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hexToRgb, layersFor, recolor, shade, stack } from "./compose";
import { KEY, LAYER_ORDER } from "./format";

const SPRITES = join(__dirname, "../../public/sprites");

describe("layersFor", () => {
  it("stacks layers in the order from the spec", () => {
    const a = { ...defaultAppearance(), accessory: { id: "cap", colors: [1, 2] } };
    expect(layersFor(a).map((l) => l.kind)).toEqual(LAYER_ORDER);
  });

  it("omits the accessory layer when there is none", () => {
    expect(layersFor(defaultAppearance()).map((l) => l.kind)).not.toContain("accessory");
  });

  it("has a sprite sheet on disk for every option and body shape", () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const appearances = [defaultAppearance(), ...Array.from({ length: 200 }, () => randomAppearance(rand))];
    for (const body of BODIES) {
      for (const [list, key] of [
        [TOPS, "top"],
        [BOTTOMS, "bottom"],
        [SHOES, "shoes"],
      ] as const) {
        for (const g of list) {
          appearances.push({
            ...defaultAppearance(),
            body: body.id,
            [key]: { id: g.id, colors: [...g.defaults] },
          });
        }
      }
    }
    for (const h of HAIR_STYLES)
      appearances.push({ ...defaultAppearance(), hair: { style: h.id, color: 0 } });
    for (const e of EYE_STYLES) appearances.push({ ...defaultAppearance(), eyes: { style: e.id, color: 0 } });
    for (const acc of ACCESSORIES)
      appearances.push({ ...defaultAppearance(), accessory: { id: acc.id, colors: [...acc.defaults] } });
    const missing = new Set<string>();
    for (const a of appearances)
      for (const l of layersFor(a)) if (!existsSync(join(SPRITES, l.path))) missing.add(l.path);
    expect([...missing]).toEqual([]);
  });

  it("maps each garment color slot to its palette color", () => {
    const a = defaultAppearance();
    const top = layersFor(a).find((l) => l.kind === "top")!;
    expect(top.colors.slot0).toEqual(hexToRgb("#4a9ae8"));
    expect(top.colors.slot0Shade).toEqual(shade(hexToRgb("#4a9ae8")));
    expect(top.colors.skin).toBeDefined();
  });
});

describe("recolor and stack", () => {
  it("swaps key colors and leaves other colors alone", () => {
    const px = new Uint8Array([...KEY.slot0, 255, 10, 20, 30, 255, ...KEY.skin, 0]);
    recolor(px, { slot0: [1, 2, 3] });
    expect([...px.slice(0, 4)]).toEqual([1, 2, 3, 255]);
    expect([...px.slice(4, 8)]).toEqual([10, 20, 30, 255]);
    expect([...px.slice(8, 12)]).toEqual([...KEY.skin, 0]);
  });

  it("draws opaque pixels of the top layer over the base", () => {
    const base = new Uint8Array([9, 9, 9, 255, 9, 9, 9, 255]);
    stack(base, new Uint8Array([1, 1, 1, 255, 5, 5, 5, 0]));
    expect([...base]).toEqual([1, 1, 1, 255, 9, 9, 9, 255]);
  });
});
