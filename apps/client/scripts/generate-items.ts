/**
 * Generates the PLACEHOLDER item icon sheet (public/items/items.png): one 16×16 icon per item in the
 * shared catalog (packages/shared/items/*.json), arranged in a grid in catalog order. Each category
 * gets its own silhouette (a badge, a gem, a chair, a cup, an envelope); items within a category are
 * told apart by a hue derived from their id, and rare items get a couple of sparkle pixels.
 *
 * The client (src/social/ItemIcon.tsx) reads icons back out of the same grid by index into
 * ITEM_DEFINITIONS, so this script and that component must agree on COLS and on item order — both
 * come from the same source (the shared catalog), so they can't drift.
 *
 * Run: pnpm --filter @hearth/client items
 */
import { ITEM_DEFINITIONS, type ItemCategory } from "@hearth/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = dirname(fileURLToPath(import.meta.url));
const OUT_PNG = join(root, "../public/items/items.png");
const T = 16;
/** Must match ITEM_ICON_COLS in src/social/ItemIcon.tsx. */
const COLS = 8;

type Px = readonly [number, number, number] | null;
type Tile = Px[][];

function hash(x: number, y: number, s = 0): number {
  let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** A deterministic, pleasant hue for this item id (0–360). */
function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function blank(): Tile {
  return Array.from({ length: T }, () => Array<Px>(T).fill(null));
}

// Ordered dithering between ramp bands, same technique as scripts/generate-town.ts, so a small
// 16×16 icon still reads as a smooth gradient instead of a hard 3-color cutoff.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const ditherThreshold = (x: number, y: number) => (BAYER4[y & 3]![x & 3]! + 0.5) / 16;
function rampAt(ramp: readonly Px[], level: number, x: number, y: number): Px {
  const t = Math.max(0, Math.min(0.9999, level)) * (ramp.length - 1);
  const lo = Math.floor(t);
  const hi = Math.min(ramp.length - 1, lo + 1);
  return t - lo > ditherThreshold(x, y) ? ramp[hi]! : ramp[lo]!;
}

const OUTLINE: Px = [26, 20, 32];

/** Fills `tile` wherever `inside(x,y)` is true with a 5-tone lit ramp, then outlines and rim-lights it. */
function shape(inside: (x: number, y: number) => boolean, hue: number): Tile {
  const t = blank();
  const ramp: Px[] = [
    hsl(hue, 0.55, 0.22),
    hsl(hue, 0.55, 0.36),
    hsl(hue, 0.55, 0.52),
    hsl(hue, 0.5, 0.68),
    hsl(hue, 0.45, 0.82),
  ];
  const rim = hsl(hue, 0.4, 0.88); // a soft, same-hue highlight, not a stark white sticker outline
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!inside(x, y)) continue;
      const level = 0.5 + (8 - x - y) / 16 + (hash(x, y, 3) - 0.5) * 0.12;
      t[y]![x] = rampAt(ramp, level, x, y);
    }
  }
  const out = t.map((row) => [...row]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (t[y]![x]) continue;
      const outer = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => t[ny!]?.[nx!]);
      if (!outer) continue;
      // A sparse rim light on the top/left-facing edge (catching the same light as the shading), a
      // dark outline everywhere else — the same "painted cel" trick used on the town tileset's props.
      const litEdge = (t[y + 1]?.[x] || t[y]?.[x + 1]) && hash(x, y, 55) < 0.5;
      out[y]![x] = litEdge ? rim : OUTLINE;
    }
  }
  return out;
}

/** A soft dithered shadow on the last row or two, so the icon reads as sitting on a surface. */
function groundShadow(t: Tile): Tile {
  const out = t.map((row) => [...row]);
  for (const y of [T - 2, T - 1]) {
    for (let x = 0; x < T; x++) {
      if (out[y]![x]) continue;
      const hasAbove = out[y - 1]?.[x] || out[y - 1]?.[x - 1] || out[y - 1]?.[x + 1];
      if (hasAbove && hash(x, y, 44) < (y === T - 1 ? 0.35 : 0.6)) out[y]![x] = [20, 16, 26];
    }
  }
  return out;
}

const SHAPES: Record<ItemCategory, (hue: number) => Tile> = {
  // A round badge/hat shape.
  cosmetics: (hue) => shape((x, y) => Math.hypot(x - 7.5, y - 7.5) < 5.5, hue),
  // A chair: a back and a seat.
  furniture: (hue) =>
    shape((x, y) => (x >= 3 && x <= 5 && y >= 3 && y <= 12) || (x >= 3 && x <= 12 && y >= 9 && y <= 11), hue),
  // A diamond gem.
  collectibles: (hue) => shape((x, y) => Math.abs(x - 7.5) + Math.abs(y - 7.5) < 6, hue),
  // A cup with a handle.
  consumables: (hue) =>
    shape((x, y) => {
      const cup = x >= 4 && x <= 10 && y >= 5 && y <= 12 && x >= 4 + (y - 5) * 0.15;
      const handleRing = Math.hypot(x - 12, y - 8.5) < 3 && Math.hypot(x - 12, y - 8.5) > 1.3 && x > 9;
      return cup || handleRing;
    }, hue),
  // An envelope with a flap.
  stationery: (hue) =>
    shape((x, y) => {
      const body = x >= 2 && x <= 13 && y >= 5 && y <= 12;
      if (!body) return false;
      const flap = Math.abs(x - 7.5) <= (y - 5) * 1.05; // triangle pointing down from the top edge
      return y >= 9 || !flap;
    }, hue),
};

/** A few bright pixels near the top-right corner, for rare items. */
function sparkle(t: Tile): Tile {
  const out = t.map((row) => [...row]);
  const gold: Px = [244, 208, 74];
  for (const [x, y] of [
    [12, 2],
    [13, 3],
    [11, 3],
  ] as const) {
    out[y]![x] = gold;
  }
  return out;
}

const items = [...ITEM_DEFINITIONS.values()];
const tiles: Tile[] = items.map((item) => {
  let t = groundShadow(SHAPES[item.category](hueOf(item.id)));
  if (item.rarity === "rare") t = sparkle(t);
  return t;
});

const rows = Math.ceil(tiles.length / COLS);
const png = new PNG({ width: COLS * T, height: rows * T });
tiles.forEach((tile, i) => {
  const ox = (i % COLS) * T;
  const oy = Math.floor(i / COLS) * T;
  tile.forEach((row, y) =>
    row.forEach((px, x) => {
      if (!px) return;
      const o = ((oy + y) * png.width + ox + x) * 4;
      png.data[o] = px[0];
      png.data[o + 1] = px[1];
      png.data[o + 2] = px[2];
      png.data[o + 3] = 255;
    }),
  );
});
mkdirSync(dirname(OUT_PNG), { recursive: true });
writeFileSync(OUT_PNG, PNG.sync.write(png));
console.log(`Wrote ${tiles.length} item icons (${COLS}×${rows} grid) to ${OUT_PNG}`);
