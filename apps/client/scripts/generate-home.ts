/**
 * Generates the PLACEHOLDER home interior tileset (public/tiles/home.png) and map
 * (packages/shared/maps/home.json, Tiled JSON with an embedded tileset).
 * The map can be opened and edited in Tiled; after hand-editing, stop regenerating it.
 *
 * The floor is exactly HOME_GRID_W × HOME_GRID_H (packages/shared/src/economy.ts) so a furniture
 * placement's (x, y) lines up 1:1 with a walkable interior tile.
 *
 * Surfaces use multi-tone ramps with ordered dithering and a top-left light bias (same technique as
 * scripts/generate-town.ts) for a cozier, more dimensional interior than flat fills.
 *
 * Run: pnpm --filter @hearth/client home
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = dirname(fileURLToPath(import.meta.url));
const TILES_PNG = join(root, "../public/tiles/home.png");
const MAP_JSON = join(root, "../../../packages/shared/maps/home.json");
const T = 16;
const COLS = 6;

// Floor size in tiles; must match HOME_GRID_W/H in packages/shared/src/economy.ts.
const FLOOR_W = 10;
const FLOOR_H = 8;
// The map adds a one-tile wall border around the floor.
const W = FLOOR_W + 2;
const H = FLOOR_H + 2;

const PAL: Record<string, string> = {
  // floorboards: dark < mid < base < highlight
  d: "#98632e",
  e: "#b47e46",
  f: "#c8965a",
  fl: "#e8c088",
  // rug: deep < dark < base < highlight, plus a gold emblem accent
  Q: "#902030",
  q: "#a82838",
  r: "#c8404a",
  rl: "#e8607a",
  Yg: "#f4d04a",
  // plaster wall: shadow < base < highlight, D is the trim
  Cd: "#c8b494",
  C: "#e8d8b8",
  Cl: "#f8ecd4",
  D: "#c8b090",
  // window glass: deep < base < light < near-white, plus a curtain accent
  xd: "#1a3a6a",
  x: "#4a9ae8",
  y: "#a8d8f8",
  yl: "#e8f4ff",
  cd: "#6a2a38",
  cr: "#c8607a",
  // door: shadow < dark < base < highlight, hd is the handle
  bd: "#3a2410",
  b: "#5a3a1e",
  hd: "#f4d04a",
  bl: "#9a6a3a",
  K: "#1a1420", // outline
};
export const PALETTE_SIZE = Object.keys(PAL).length;

type Px = string | null;
type Tile = Px[][];
const blank = (): Tile => Array.from({ length: T }, () => Array<Px>(T).fill(null));

function hash(x: number, y: number, s = 0): number {
  let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Ordered dithering between ramp bands, same technique as scripts/generate-town.ts.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const ditherThreshold = (x: number, y: number) => (BAYER4[y & 3]![x & 3]! + 0.5) / 16;
function rampAt(ramp: readonly string[], level: number, x: number, y: number): string {
  const t = Math.max(0, Math.min(0.9999, level)) * (ramp.length - 1);
  const lo = Math.floor(t);
  const hi = Math.min(ramp.length - 1, lo + 1);
  return t - lo > ditherThreshold(x, y) ? ramp[hi]! : ramp[lo]!;
}

const FLOOR = ["d", "e", "f", "fl"] as const;
const RUG = ["Q", "q", "r", "rl"] as const;
const WALL = ["Cd", "C", "Cl"] as const;
const GLASS = ["xd", "x", "y", "yl"] as const;
const DOOR = ["bd", "b", "b", "bl"] as const;

/** Wood-plank floor: horizontal boards with grain streaks and a beveled highlight along each seam. */
function floor(seed: number): Tile {
  const t = blank();
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const board = Math.floor(y / 4);
      const withinBoard = y % 4;
      let level = 0.55 + (hash(x, board, seed) - 0.5) * 0.25 + (hash(x, y, seed + 40) - 0.5) * 0.1;
      if (withinBoard === 0) level += 0.28; // beveled top edge of each plank
      if (withinBoard === 3) level -= 0.25; // seam shadow
      t[y]![x] = rampAt(FLOOR, level, x, y);
    }
  return t;
}

/** A seamless patterned rug: a repeating diamond medallion over a dithered field, tiled edge to edge. */
function rug(): Tile {
  const t = blank();
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const level = 0.45 + (hash(x, y, 12) - 0.5) * 0.2;
      t[y]![x] = rampAt(RUG, level, x, y);
    }
  const cx = T / 2 - 0.5;
  const cy = T / 2 - 0.5;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const diamond = Math.abs(x - cx) + Math.abs(y - cy);
      if (diamond < 2) t[y]![x] = "Yg";
      else if (diamond < 3) t[y]![x] = "rl";
    }
  return t;
}

/** A single-row top-down wall: plaster texture with a timber trim seam top and bottom. */
function wall(): Tile {
  const t = blank();
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const level = 0.5 + (hash(x, y, 2) - 0.5) * 0.3 + ((T - 1 - y) / T) * 0.15;
      t[y]![x] = rampAt(WALL, level, x, y);
    }
  for (let x = 0; x < T; x++) t[0]![x] = "D";
  t[T - 1] = Array<Px>(T).fill("D");
  return t;
}

/** A warm window with a beveled frame, a soft sky gradient, and a curtain draped at the corners. */
function wallWindow(): Tile {
  const t = wall();
  for (let y = 2; y < 11; y++)
    for (let x = 3; x < 13; x++) {
      const edge = y === 2 || y === 10 || x === 3 || x === 12;
      if (edge) {
        t[y]![x] = "b";
        continue;
      }
      const level = 0.35 + ((10 - y) / 8) * 0.55 + (hash(x, y, 5) - 0.5) * 0.08;
      t[y]![x] = rampAt(GLASS, level, x, y);
    }
  // Cross-bars.
  for (let y = 3; y < 10; y++) t[y]![7] = "b";
  for (let x = 4; x < 12; x++) t[6]![x] = "b";
  // Curtain drapes at the top corners.
  for (const side of [0, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = side ? 12 + i - 1 : 2 - i + 1;
      if (x < 0 || x >= T) continue;
      const y = 1 + i;
      t[y]![x] = i % 2 ? "cd" : "cr";
    }
  }
  return t;
}

/** A four-panel door with beveled panels and a round handle. */
function door(): Tile {
  const t = blank();
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) t[y]![x] = rampAt(DOOR, 0.5 + (hash(x, y, 6) - 0.5) * 0.18, x, y);
  for (let y = 0; y < T; y++) t[y]![0] = t[y]![T - 1] = "K";
  t[0] = Array<Px>(T).fill("K");
  t[T - 1] = Array<Px>(T).fill("K");
  const panel = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || y === y0;
        const farEdge = x === x1 || y === y1;
        t[y]![x] = edge ? "bl" : farEdge ? "bd" : "b";
      }
    for (let y = y0; y <= y1; y++) {
      t[y]![x0] = "K";
      t[y]![x1] = "K";
    }
    for (let x = x0; x <= x1; x++) {
      t[y0]![x] = "K";
      t[y1]![x] = "K";
    }
  };
  panel(2, 1, 6, 6);
  panel(2, 8, 6, 13);
  panel(9, 1, T - 3, 6);
  panel(9, 8, T - 3, 13);
  t[7]![2] = t[7]![T - 3] = "K";
  // Handle.
  t[8]![T - 5] = "K";
  t[9]![T - 5] = "hd";
  return t;
}

const tiles: Tile[] = [];
const ids: Record<string, number> = {};
const collides = new Set<number>();
function add(name: string, tile: Tile, blocks = false) {
  ids[name] = tiles.length;
  if (blocks) collides.add(tiles.length);
  tiles.push(tile);
}

add("floor", floor(1));
add("floor2", floor(2));
add("rug", rug());
add("wall", wall(), true);
add("wallWindow", wallWindow(), true);
add("door", door());
// Invisible, collision-only tile (a common Tiled convention).
add("blocker", blank(), true);

const rowsN = Math.ceil(tiles.length / COLS);
const png = new PNG({ width: COLS * T, height: rowsN * T });
const used = new Set<string>();
tiles.forEach((tile, i) => {
  const ox = (i % COLS) * T;
  const oy = Math.floor(i / COLS) * T;
  tile.forEach((row, y) =>
    row.forEach((k, x) => {
      if (!k) return;
      const hex = PAL[k];
      if (!hex) throw new Error(`Unknown palette key ${k}`);
      used.add(hex);
      const n = parseInt(hex.slice(1), 16);
      const o = ((oy + y) * png.width + ox + x) * 4;
      png.data[o] = (n >> 16) & 255;
      png.data[o + 1] = (n >> 8) & 255;
      png.data[o + 2] = n & 255;
      png.data[o + 3] = 255;
    }),
  );
});
if (used.size > 40) throw new Error(`Home palette uses ${used.size} colors; the limit is 40`);
mkdirSync(dirname(TILES_PNG), { recursive: true });
writeFileSync(TILES_PNG, PNG.sync.write(png));

// ---------- Build the map ----------
const ground = Array<number>(W * H).fill(ids.wall!);
const at = (x: number, y: number) => y * W + x;
for (let y = 1; y <= FLOOR_H; y++)
  for (let x = 1; x <= FLOOR_W; x++) ground[at(x, y)] = hash(x, y, 9) < 0.15 ? ids.floor2! : ids.floor!;
// A rug in the middle of the room.
for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) ground[at(x, y)] = ids.rug!;
// A window on the back wall.
ground[at(Math.floor(W / 2), 0)] = ids.wallWindow!;
// The door, bottom-centre, is the only opening in the wall — and the spawn point.
const doorX = Math.floor(W / 2);
ground[at(doorX, H - 1)] = ids.door!;

let nextId = 1;
const objects = [
  {
    id: nextId++,
    name: "spawn",
    type: "spawn",
    x: doorX * T,
    y: (H - 2) * T,
    width: 0,
    height: 0,
    point: true,
    rotation: 0,
    visible: true,
    properties: [],
  },
];

const gid = (id: number) => id + 1;
const layer = (id: number, name: string, data: number[]) => ({
  id,
  name,
  type: "tilelayer",
  width: W,
  height: H,
  x: 0,
  y: 0,
  opacity: 1,
  visible: true,
  data: data.map(gid),
});

const map = {
  type: "map",
  version: "1.10",
  tiledversion: "1.10.2",
  orientation: "orthogonal",
  renderorder: "right-down",
  infinite: false,
  width: W,
  height: H,
  tilewidth: T,
  tileheight: T,
  nextlayerid: 5,
  nextobjectid: nextId,
  layers: [
    layer(1, "ground", ground),
    layer(2, "decor", Array<number>(W * H).fill(-1)),
    // Empty, but WorldScene.ts always creates it (town has trees that overhang the player here).
    layer(3, "overhead", Array<number>(W * H).fill(-1)),
    {
      id: 4,
      name: "objects",
      type: "objectgroup",
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      draworder: "topdown",
      objects,
    },
  ],
  tilesets: [
    {
      firstgid: 1,
      name: "home",
      image: "../../../apps/client/public/tiles/home.png",
      imagewidth: COLS * T,
      imageheight: rowsN * T,
      tilewidth: T,
      tileheight: T,
      tilecount: tiles.length,
      columns: COLS,
      margin: 0,
      spacing: 0,
      tiles: [...collides].map((id) => ({
        id,
        properties: [{ name: "collides", type: "bool", value: true }],
      })),
    },
  ],
};
mkdirSync(dirname(MAP_JSON), { recursive: true });
writeFileSync(MAP_JSON, JSON.stringify(map));
console.log(`Wrote ${tiles.length} tiles (${used.size} colors) and a ${W}×${H} home map.`);
