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

/** Fills `tile` wherever `inside(x,y)` is true, shading by a light direction, outlining the silhouette. */
function shape(inside: (x: number, y: number) => boolean, hue: number): Tile {
  const t = blank();
  const [baseR, baseG, baseB] = hsl(hue, 0.55, 0.55);
  const [darkR, darkG, darkB] = hsl(hue, 0.55, 0.32);
  const [liteR, liteG, liteB] = hsl(hue, 0.5, 0.72);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!inside(x, y)) continue;
      const lightness = (8 - x - y) / 10 + hash(x, y, 3) * 0.3;
      t[y]![x] =
        lightness > 0.35
          ? [liteR, liteG, liteB]
          : lightness < -0.35
            ? [darkR, darkG, darkB]
            : [baseR, baseG, baseB];
    }
  }
  // Outline: any transparent pixel next to a filled one becomes a dark edge.
  const out = t.map((row) => [...row]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (t[y]![x]) continue;
      const neighbor = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => t[ny!]?.[nx!]);
      if (neighbor) out[y]![x] = [26, 20, 32];
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
  const t = SHAPES[item.category](hueOf(item.id));
  return item.rarity === "rare" ? sparkle(t) : t;
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
