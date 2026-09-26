/**
 * Sprite sheet format shared by the placeholder generator and the runtime compositor.
 * See docs/art-pipeline.md for how artists should author sheets in this format.
 */

export const FRAME_W = 16;
export const FRAME_H = 24;
/** Columns: idle, step A, passing, step B. The walk cycle plays 1, 2, 3, 2. */
export const FRAMES = 4;
/** Rows, in this order. */
export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const SHEET_W = FRAME_W * FRAMES;
export const SHEET_H = FRAME_H * DIRECTIONS.length;
export const WALK_CYCLE = [1, 2, 3, 2];

/**
 * Key colors. Sheets are drawn with these exact RGB values, and the compositor swaps each one for the
 * player's chosen color at runtime. Any other color in a sheet is drawn as-is.
 */
export const KEY = {
  slot0: [255, 0, 0],
  slot0Shade: [128, 0, 0],
  slot1: [0, 255, 0],
  slot1Shade: [0, 128, 0],
  slot2: [0, 0, 255],
  slot2Shade: [0, 0, 128],
  skin: [255, 255, 0],
  skinShade: [128, 128, 0],
  hair: [0, 255, 255],
  hairShade: [0, 128, 128],
  eye: [255, 0, 255],
} as const satisfies Record<string, readonly [number, number, number]>;
export type KeyName = keyof typeof KEY;

/** Fixed colors that are never swapped. */
export const OUTLINE: readonly [number, number, number] = [26, 20, 32];
export const WHITE: readonly [number, number, number] = [250, 250, 245];

export type LayerKind = "body" | "eyes" | "hairBack" | "bottom" | "top" | "shoes" | "hairFront" | "accessory";

/** Draw order, back to front. Matches PROMPT.md Section 5. */
export const LAYER_ORDER: LayerKind[] = [
  "body",
  "eyes",
  "hairBack",
  "bottom",
  "top",
  "shoes",
  "hairFront",
  "accessory",
];

/** Path (under /sprites/) of the sheet for one layer option. Garments are drawn per body shape. */
export function sheetPath(kind: LayerKind, id: string, body: string): string {
  switch (kind) {
    case "body":
      return `body/${id}.png`;
    case "bottom":
    case "top":
    case "shoes":
      return `${kind}/${id}_${body}.png`;
    default:
      return `${kind}/${id}.png`;
  }
}
