import {
  ACCESSORIES,
  BOTTOMS,
  CLOTHING_PALETTE,
  EYE_COLORS,
  HAIR_COLORS,
  SHOES,
  SKIN_TONES,
  TOPS,
  garmentDef,
  type Appearance,
  type GarmentChoice,
} from "@hearth/shared";
import { KEY, sheetPath, type KeyName, type LayerKind } from "./format";

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Shadow tone for a clothing color: 30% darker with a slight cool shift, like hand-picked GBC shading. */
export function shade([r, g, b]: RGB): RGB {
  return [Math.round(r * 0.66), Math.round(g * 0.66), Math.round(b * 0.72)];
}

export type ColorMap = Partial<Record<KeyName, RGB>>;

/** Which sheets to stack for an appearance, and how to recolor each. Order is back to front. */
export function layersFor(a: Appearance): { kind: LayerKind; path: string; colors: ColorMap }[] {
  const skinPair = SKIN_TONES[a.skin]!;
  const hairPair = HAIR_COLORS[a.hair.color]!;
  const skin: ColorMap = { skin: hexToRgb(skinPair[0]), skinShade: hexToRgb(skinPair[1]) };
  const hair: ColorMap = { hair: hexToRgb(hairPair[0]), hairShade: hexToRgb(hairPair[1]) };
  const garment = (g: GarmentChoice): ColorMap => {
    const map: ColorMap = { ...skin };
    g.colors.forEach((ci, i) => {
      const rgb = hexToRgb(CLOTHING_PALETTE[ci]!);
      const slot = `slot${i}` as KeyName;
      map[slot] = rgb;
      map[`${slot}Shade` as KeyName] = shade(rgb);
    });
    return map;
  };
  const layers: { kind: LayerKind; path: string; colors: ColorMap }[] = [
    { kind: "body", path: sheetPath("body", a.body, a.body), colors: skin },
    {
      kind: "eyes",
      path: sheetPath("eyes", a.eyes.style, a.body),
      colors: { eye: hexToRgb(EYE_COLORS[a.eyes.color]!) },
    },
    { kind: "hairBack", path: sheetPath("hairBack", a.hair.style, a.body), colors: hair },
    { kind: "bottom", path: sheetPath("bottom", a.bottom.id, a.body), colors: garment(a.bottom) },
    { kind: "top", path: sheetPath("top", a.top.id, a.body), colors: garment(a.top) },
    { kind: "shoes", path: sheetPath("shoes", a.shoes.id, a.body), colors: garment(a.shoes) },
    { kind: "hairFront", path: sheetPath("hairFront", a.hair.style, a.body), colors: hair },
  ];
  if (a.accessory) {
    layers.push({
      kind: "accessory",
      path: sheetPath("accessory", a.accessory.id, a.body),
      colors: garment(a.accessory),
    });
  }
  return layers;
}

const KEY_ENTRIES = Object.entries(KEY) as [KeyName, readonly [number, number, number]][];

/** Replaces key colors in RGBA pixel data, in place. Pixels that aren't key colors are left alone. */
export function recolor(data: Uint8ClampedArray | Uint8Array, colors: ColorMap): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (const [name, [r, g, b]] of KEY_ENTRIES) {
      if (data[i] === r && data[i + 1] === g && data[i + 2] === b) {
        const to = colors[name];
        if (to) {
          data[i] = to[0];
          data[i + 1] = to[1];
          data[i + 2] = to[2];
        }
        break;
      }
    }
  }
}

/** Draws `top` over `base` (both RGBA, same size). Pixels are either fully opaque or fully transparent. */
export function stack(base: Uint8ClampedArray | Uint8Array, top: Uint8ClampedArray | Uint8Array): void {
  for (let i = 0; i < base.length; i += 4) {
    if (top[i + 3]! > 0) {
      base[i] = top[i]!;
      base[i + 1] = top[i + 1]!;
      base[i + 2] = top[i + 2]!;
      base[i + 3] = 255;
    }
  }
}

/** Catalog lists, re-exported for the creator UI. */
export const GARMENTS = { top: TOPS, bottom: BOTTOMS, shoes: SHOES, accessory: ACCESSORIES };
export { garmentDef };
