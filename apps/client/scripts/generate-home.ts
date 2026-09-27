/**
 * Generates the PLACEHOLDER home interior tileset (public/tiles/home.png) and map
 * (packages/shared/maps/home.json, Tiled JSON with an embedded tileset).
 * The map can be opened and edited in Tiled; after hand-editing, stop regenerating it.
 *
 * The floor is exactly HOME_GRID_W × HOME_GRID_H (packages/shared/src/economy.ts) so a furniture
 * placement's (x, y) lines up 1:1 with a walkable interior tile.
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
  f: "#c8965a",
  e: "#b47e46",
  d: "#98632e", // wood floor
  r: "#c8404a",
  q: "#a82838",
  Q: "#902030", // rug
  C: "#e8d8b8",
  D: "#c8b090", // walls
  w: "#7a5230",
  b: "#5a3a1e", // door wood
  y: "#a8d8f8",
  x: "#4a9ae8", // window glass
  K: "#1a1420", // outline
};
export const PALETTE_SIZE = Object.keys(PAL).length;

type Px = string | null;
type Tile = Px[][];
const fill = (k: string): Tile => Array.from({ length: T }, () => Array<Px>(T).fill(k));
const blank = (): Tile => Array.from({ length: T }, () => Array<Px>(T).fill(null));

function hash(x: number, y: number, s = 0): number {
  let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function floor(seed: number): Tile {
  const t = fill("f");
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      if (y % 4 === 3) t[y]![x] = "e";
      if (hash(x, y, seed) < 0.03) t[y]![x] = "d";
    }
  return t;
}

function rug(): Tile {
  const t = fill("q");
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      if (x < 2 || y < 2 || x > T - 3 || y > T - 3) t[y]![x] = "Q";
      else if (x < 3 || y < 3 || x > T - 4 || y > T - 4) t[y]![x] = "r";
    }
  return t;
}

function wall(): Tile {
  const t = fill("C");
  for (let x = 0; x < T; x++) t[0]![x] = "D";
  for (let y = 0; y < T; y++)
    if (y % 5 === 4) for (let x = 0; x < T; x++) if (hash(x >> 2, y, 1) < 0.4) t[y]![x] = "D";
  t[T - 1] = Array<Px>(T).fill("D");
  return t;
}

function wallWindow(): Tile {
  const t = wall();
  for (let y = 3; y < 10; y++)
    for (let x = 4; x < 12; x++) {
      const edge = y === 3 || y === 9 || x === 4 || x === 11;
      t[y]![x] = edge ? "K" : (x + y) % 3 === 0 ? "x" : "y";
    }
  return t;
}

function door(): Tile {
  const t = fill("D");
  for (let y = 0; y < T; y++) t[y]![0] = t[y]![T - 1] = "K";
  for (let y = 2; y < T; y++) for (let x = 2; x < T - 2; x++) t[y]![x] = "b";
  for (let y = 2; y < T; y++) {
    t[y]![2] = "K";
    t[y]![T - 3] = "K";
  }
  t[Math.floor(T / 2)]![T - 5] = "f";
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
if (used.size > 32) throw new Error(`Home palette uses ${used.size} colors; the limit is 32`);
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
