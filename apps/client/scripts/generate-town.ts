/**
 * Generates the PLACEHOLDER Town Square tileset (public/tiles/town.png) and map
 * (packages/shared/maps/town.json, Tiled JSON with an embedded tileset).
 * The map can be opened and edited in Tiled; after hand-editing, stop regenerating it.
 *
 * Run: pnpm --filter @hearth/client town
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = dirname(fileURLToPath(import.meta.url));
const TILES_PNG = join(root, "../public/tiles/town.png");
const MAP_JSON = join(root, "../../../packages/shared/maps/town.json");
const T = 16;
const COLS = 8;

// ---------- Palette: at most 32 colors for the whole area (PROMPT.md Section 3) ----------
const PAL: Record<string, string> = {
  g: "#5a9a48",
  h: "#4e8a3e",
  l: "#78b858",
  d: "#3a6a30", // grass
  p: "#c8a870",
  q: "#a88850",
  r: "#e0c890", // path / sand
  s: "#b8b8c0",
  t: "#8a8a98",
  u: "#d8d8e0",
  v: "#5a5a6a", // stone
  w: "#4a9ae8",
  x: "#2a6ac8",
  y: "#a8d8f8", // water
  b: "#8a5a2e",
  c: "#5a3a1e",
  e: "#b87a40", // wood
  R: "#c83a3a",
  Q: "#8a2230",
  U: "#3a5ac8",
  V: "#22348a",
  N: "#3a9a6a",
  M: "#226a44", // roofs
  C: "#f0e0c0",
  D: "#c8b090", // walls
  F: "#f08ac0",
  Y: "#f4d04a",
  X: "#f4f4f0",
  K: "#1a1420", // flowers, white, outline
  P: "#8a5ae0",
  O: "#c8b8f0", // portal
};
export const PALETTE_SIZE = Object.keys(PAL).length;

type Px = string | null; // palette key or transparent
type Tile = Px[][]; // [y][x]

const blank = (w = T, h = T): Tile => Array.from({ length: h }, () => Array<Px>(w).fill(null));
const fill = (k: string, w = T, h = T): Tile => Array.from({ length: h }, () => Array<Px>(w).fill(k));

/** Deterministic pseudo-random in [0,1) from integer coordinates. */
function hash(x: number, y: number, s = 0): number {
  let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Tile from string art: one character per pixel, space = transparent. */
function art(rows: string[]): Tile {
  return rows.map((row) => [...row.padEnd(rows[0]!.length)].map((ch) => (ch === " " ? null : ch)));
}

function over(base: Tile, top: Tile): Tile {
  return base.map((row, y) => row.map((px, x) => top[y]?.[x] ?? px));
}

/** Splits a 32×32 (or 32×16) drawing into 16×16 tiles, row by row. */
function split(big: Tile): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < big.length / T; ty++)
    for (let tx = 0; tx < big[0]!.length / T; tx++)
      out.push(big.slice(ty * T, ty * T + T).map((r) => r.slice(tx * T, tx * T + T)));
  return out;
}

function outline(tile: Tile): Tile {
  const h = tile.length;
  const w = tile[0]!.length;
  const out = tile.map((r) => [...r]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (tile[y]![x]) continue;
      const n = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([a, b]) => tile[b!]?.[a!]);
      if (n) out[y]![x] = "K";
    }
  return out;
}

// ---------- Ground tiles ----------
function grass(seed: number, tufts = false): Tile {
  const t = fill("g");
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const r = hash(x, y, seed);
      if (r < 0.08) t[y]![x] = "h";
      else if (r > 0.95) t[y]![x] = "l";
    }
  if (tufts)
    for (const [cx, cy] of [
      [3, 5],
      [11, 10],
      [6, 13],
    ] as [number, number][]) {
      t[cy]![cx] = "d";
      t[cy - 1]![cx - 1] = "h";
      t[cy - 1]![cx + 1] = "h";
      t[cy - 2]![cx] = "l";
    }
  return t;
}

function flowers(a: string, b: string, seed: number): Tile {
  const t = grass(seed);
  const spots = [
    [3, 3, a],
    [11, 4, b],
    [6, 9, b],
    [13, 12, a],
    [2, 13, a],
  ] as const;
  for (const [x, y, c] of spots) {
    t[y - 1]![x] = c;
    t[y + 1]![x] = c;
    t[y]![x - 1] = c;
    t[y]![x + 1] = c;
    t[y]![x] = "Y";
    t[y + 2]![x] = "d";
  }
  return t;
}

function speckle(base: string, a: string, b: string, seed: number, pa = 0.1, pb = 0.06): Tile {
  const t = fill(base);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const r = hash(x, y, seed);
      if (r < pa) t[y]![x] = a;
      else if (r > 1 - pb) t[y]![x] = b;
    }
  return t;
}

function plaza(): Tile {
  const t = fill("s");
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const brickRow = Math.floor(y / 8);
      const off = brickRow % 2 ? 4 : 0;
      if (y % 8 === 7 || (x + off) % 8 === 7) t[y]![x] = "t";
      else if (y % 8 === 0 || (x + off) % 8 === 0) t[y]![x] = "u";
    }
  return t;
}

function water(seed: number): Tile {
  const t = fill("w");
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      if (hash(x >> 2, y, seed) < 0.12 && y % 4 === 1) t[y]![x] = "y";
      else if (hash(x, y, seed + 9) < 0.05) t[y]![x] = "x";
    }
  return t;
}

function tallGrass(): Tile {
  const t = grass(77);
  for (let bx = 0; bx < T; bx += 4)
    for (let by = 2; by < T; by += 5) {
      const x = bx + ((by / 5) % 2 ? 2 : 0);
      if (x + 2 >= T) continue;
      t[by]![x + 1] = "l";
      t[by + 1]![x] = "d";
      t[by + 1]![x + 1] = "h";
      t[by + 1]![x + 2] = "d";
      if (by + 2 < T) t[by + 2]![x + 1] = "d";
    }
  return t;
}

// ---------- Objects (transparent background) ----------
function tree(): Tile[] {
  const big = blank(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5;
      const dy = y - 12;
      const r = Math.hypot(dx, dy * 1.1) + hash(x >> 1, y >> 1, 3) * 2.2;
      if (r < 13.5) {
        const lightness = (-dx - dy) / 18 + hash(x >> 2, y >> 2, 5) * 0.5;
        big[y]![x] = lightness > 0.75 ? "l" : lightness > 0.05 ? "g" : lightness > -0.6 ? "h" : "d";
      }
    }
  for (let y = 22; y < 30; y++)
    for (let x = 13; x < 19; x++) if (!big[y]![x] || y > 24) big[y]![x] = x < 15 ? "e" : x > 16 ? "c" : "b";
  const shaded = outline(big);
  for (let x = 10; x < 22; x++) if (!shaded[30]![x]) shaded[30]![x] = "d";
  return split(shaded);
}

const BUSH = art([
  "                ",
  "                ",
  "                ",
  "     KKKKKK     ",
  "   KKllggghKK   ",
  "  KlllgggghhhK  ",
  " KllggggghhhhhK ",
  " KlggggghhhhhdK ",
  " KgggghhhhhhddK ",
  " KggghhhhhhdddK ",
  " KhhhhhhhhddddK ",
  "  KhhhhhddddddK ",
  "   KKddddddKK   ",
  "     KKKKKK     ",
  "   dddddddddd   ",
  "                ",
]);

const ROCK = art([
  "                ",
  "                ",
  "                ",
  "                ",
  "      KKKKK     ",
  "    KKuussKK    ",
  "   KuussssstK   ",
  "  KusssssstttK  ",
  "  KssssssttttK  ",
  "  KssssstttvvK  ",
  "  KtsssttttvvK  ",
  "   KtttttvvvK   ",
  "    KKKKKKKK    ",
  "   dddddddddd   ",
  "                ",
  "                ",
]);

const FENCE = art([
  "                ",
  "                ",
  " KK          KK ",
  "KeeK        KeeK",
  "KebKKKKKKKKKKebK",
  "KebeeeeeeeeeeebK",
  "KebbbbbbbbbbbbbK",
  "KebKKKKKKKKKKebK",
  "KebK        KebK",
  "KebKKKKKKKKKKebK",
  "KebeeeeeeeeeeebK",
  "KebbbbbbbbbbbbbK",
  "KebKKKKKKKKKKebK",
  "KcbK        KcbK",
  " KK          KK ",
  " dd          dd ",
]);

const SIGN = art([
  "                ",
  "                ",
  "  KKKKKKKKKKKK  ",
  " KeeeeeeeeeeeeK ",
  " KeCCCCCCCCCCbK ",
  " KeCKKCKKKCCCbK ",
  " KeCCCCCCCCCCbK ",
  " KeCKKKCKKCCCbK ",
  " KeCCCCCCCCCCbK ",
  " KbbbbbbbbbbbbK ",
  "  KKKKKebKKKKK  ",
  "      KebK      ",
  "      KebK      ",
  "      KcbK      ",
  "     dKKKKd     ",
  "                ",
]);

const POT = art([
  "                ",
  "     F  Y       ",
  "    FYF YXY  F  ",
  "     F hYh  FYF ",
  "    h  hlh h F  ",
  "     hlhghlh    ",
  "   KKKKKKKKKK   ",
  "   KeeeeeeeeK   ",
  "   KRRRRRRRQK   ",
  "    KRRRRRRQK   ",
  "    KRRRRRRQK   ",
  "    KQRRRRQQK   ",
  "     KQQQQQK    ",
  "     KKKKKKK    ",
  "    ddddddddd   ",
  "                ",
]);

function bench(): Tile[] {
  const rows = [
    "                                ",
    "                                ",
    "                                ",
    "                                ",
    "  KKKKKKKKKKKKKKKKKKKKKKKKKKKK  ",
    "  KeeeeeeeeeeeeeeeeeeeeeeeeeeK  ",
    "  KbbbbbbbbbbbbbbbbbbbbbbbbbbK  ",
    "  KKKKKKKKKKKKKKKKKKKKKKKKKKKK  ",
    "  KeeeeeeeeeeeeeeeeeeeeeeeeeeK  ",
    "  KbbbbbbbbbbbbbbbbbbbbbbbbbbK  ",
    "  KKKKKKKKKKKKKKKKKKKKKKKKKKKK  ",
    "   KvK                    KvK   ",
    "   KvK                    KvK   ",
    "   KvK                    KvK   ",
    "   KKK                    KKK   ",
    "                                ",
  ];
  return split(art(rows));
}

function fountain(): Tile[] {
  const big = blank(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const r = Math.hypot(x - 15.5, (y - 16) * 1.25);
      if (r < 15.5)
        big[y]![x] = r > 13 ? (y < 16 ? "u" : "t") : r > 11.5 ? "s" : hash(x >> 1, y, 4) < 0.15 ? "y" : "w";
    }
  // Centre spout with a splash.
  for (let y = 8; y < 20; y++) for (let x = 14; x < 18; x++) big[y]![x] = x < 16 ? "u" : "t";
  for (const [x, y] of [
    [15, 5],
    [16, 5],
    [13, 6],
    [18, 6],
    [15, 7],
    [16, 7],
    [12, 8],
    [19, 8],
  ])
    big[y!]![x!] = "y";
  for (let x = 13; x < 19; x++) big[8]![x] = "u";
  return split(outline(big));
}

function portal(): Tile[] {
  const big = blank(32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const r = Math.hypot(x - 15.5, (y - 16) * 1.3);
      if (r < 15) {
        if (r > 11.5) {
          const a = Math.atan2(y - 16, x - 15.5);
          big[y]![x] = Math.floor((a + Math.PI) * 3) % 2 ? "s" : "t";
        } else big[y]![x] = r < 5 ? "O" : hash(x, y, 8) < 0.2 ? "O" : "P";
      }
    }
  for (const [x, y] of [
    [10, 12],
    [20, 18],
    [14, 20],
    [19, 10],
  ])
    big[y!]![x!] = "X";
  return split(outline(big));
}

function lamp(): Tile[] {
  const rows = [
    "                ",
    "                ",
    "                ",
    "                ",
    "      KKKK      ",
    "     KvvvvK     ",
    "    KYYYYYYK    ",
    "    KYXXYYYK    ",
    "    KYXYYYYK    ",
    "    KYYYYYYK    ",
    "     KvvvvK     ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "      KvvK      ",
    "     KvvvvK     ",
    "    KvvvvvvK    ",
    "    KKKKKKKK    ",
    "     dddddd     ",
    "                ",
    "                ",
    "                ",
  ];
  const [top, bottom] = [art(rows.slice(0, 16)), art(rows.slice(16, 32))];
  return [top, bottom];
}

function noticeBoard(): Tile[] {
  const rows = [
    "                                ",
    " KKKKKKKKKKKKKKKKKKKKKKKKKKKKKK ",
    " KeeeeeeeeeeeeeeeeeeeeeeeeeeeeK ",
    " KebbbbbbbbbbbbbbbbbbbbbbbbbbcK ",
    " KebCCCCKbbbXXXXXbbYYYYbbCCCbcK ",
    " KebCKKCKbbbXKKKXbbYKKYbbCKCbcK ",
    " KebCCCCKbbbXXXXXbbYYYYbbCCCbcK ",
    " KebCKKCKbbbXKKXXbbYKYYbbCKCbcK ",
    " KebCCCCKbbbXXXXXbbYYYYbbCCCbcK ",
    " KebbbbbbbbbbbbbbbbbbbbbbbbbbcK ",
    " KccccccccccccccccccccccccccccK ",
    " KKKKKKKKKKKKKKKKKKKKKKKKKKKKKK ",
    "    KebK              KebK      ",
    "    KebK              KebK      ",
    "    KcbK              KcbK      ",
    "   ddKKdd            ddKKdd     ",
  ];
  return split(art(rows));
}

function roof(main: string, dark: string, part: "L" | "M" | "R"): Tile {
  const t = fill(main);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      if (y % 4 === 3) t[y]![x] = dark;
      else if ((x + (Math.floor(y / 4) % 2) * 4) % 8 === 0) t[y]![x] = dark;
    }
  for (let y = 0; y < T; y++) {
    if (part === "L") {
      t[y]![0] = "K";
      t[y]![1] = dark;
    }
    if (part === "R") {
      t[y]![15] = "K";
      t[y]![14] = dark;
    }
  }
  return t;
}

function wall(kind: "plain" | "window" | "door"): Tile {
  const t = fill("C");
  for (let x = 0; x < T; x++) t[0]![x] = "D";
  for (let y = 0; y < T; y++)
    if (y % 5 === 4) for (let x = 0; x < T; x++) if (hash(x >> 3, y, 2) < 0.5) t[y]![x] = "D";
  t[T - 1] = Array<Px>(T).fill("D");
  if (kind === "window")
    return over(
      t,
      art([
        "                ",
        "                ",
        "   KKKKKKKKKK   ",
        "   KyyyyKwwwK   ",
        "   KyyywKwwxK   ",
        "   KyywwKwxxK   ",
        "   KKKKKKKKKK   ",
        "   KwwwwKwxxK   ",
        "   KwwwxKxxxK   ",
        "   KKKKKKKKKK   ",
        "  KeeeeeeeeeeK  ",
        "   FYF  FYFY    ",
        "                ",
      ]),
    );
  if (kind === "door")
    return over(
      t,
      art([
        "                ",
        "   KKKKKKKKKK   ",
        "   KeeeeeeeebK  ",
        "   KebbbbbbbbK  ",
        "   KebKKbKKbbK  ",
        "   KebKybKybbK  ",
        "   KebKKbKKbbK  ",
        "   KebbbbbbbbK  ",
        "   KebbbbbbYbK  ",
        "   KebbbbbbYbK  ",
        "   KebbbbbbbbK  ",
        "   KebbbbbbbbK  ",
        "   KebbbbbbbbK  ",
        "   KebbbbbbbbK  ",
        "   KccccccccbK  ",
        "  KKKKKKKKKKKK  ",
      ]),
    );
  return t;
}

// ---------- Tile IDs ----------
const tiles: Tile[] = [];
const ids: Record<string, number> = {};
const collides = new Set<number>();
function add(name: string, tile: Tile, blocks = false) {
  ids[name] = tiles.length;
  if (blocks) collides.add(tiles.length);
  tiles.push(tile);
}

add("grass", grass(1));
add("grass2", grass(2, true));
add("flowersPink", flowers("F", "X", 3));
add("flowersYellow", flowers("Y", "F", 4));
add("path", speckle("p", "q", "r", 5));
add("plaza", plaza());
add("water", water(6), true);
add("sand", speckle("r", "p", "u", 7, 0.12, 0.02));
add("tallGrass", tallGrass());
const [tTL, tTR, tBL, tBR] = tree();
add("treeTL", tTL!);
add("treeTR", tTR!);
add("treeBL", tBL!, true);
add("treeBR", tBR!, true);
add("bush", BUSH, true);
add("rock", ROCK, true);
add("fence", FENCE, true);
add("sign", SIGN, true);
add("pot", POT, true);
const [bL, bR] = bench();
add("benchL", bL!, true);
add("benchR", bR!, true);
fountain().forEach((t, i) => add(`fountain${i}`, t, true));
portal().forEach((t, i) => add(`portal${i}`, t, true));
const [lampTop, lampBottom] = lamp();
add("lampTop", lampTop!);
add("lampBottom", lampBottom!, true);
const [nbL, nbR] = noticeBoard();
add("boardL", nbL!, true);
add("boardR", nbR!, true);
for (const [color, main, dark] of [
  ["Red", "R", "Q"],
  ["Blue", "U", "V"],
  ["Green", "N", "M"],
] as const)
  for (const part of ["L", "M", "R"] as const) add(`roof${color}${part}`, roof(main, dark, part), true);
add("wall", wall("plain"), true);
// Invisible, collision-only tile (a common Tiled convention).
add("blocker", blank(), true);
add("wallWindow", wall("window"), true);
add("door", wall("door"), true);

// ---------- Write the tileset PNG ----------
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
if (used.size > 32) throw new Error(`Town palette uses ${used.size} colors; the limit is 32`);
mkdirSync(dirname(TILES_PNG), { recursive: true });
writeFileSync(TILES_PNG, PNG.sync.write(png));

// ---------- Build the map ----------
const W = 40;
const H = 30;
const ground = Array<number>(W * H).fill(ids.grass!);
const decor = Array<number>(W * H).fill(-1);
const overhead = Array<number>(W * H).fill(-1);
const at = (x: number, y: number) => y * W + x;
const set = (layer: number[], x: number, y: number, id: number) => {
  if (x >= 0 && y >= 0 && x < W && y < H) layer[at(x, y)] = id;
};
const rect = (layer: number[], x0: number, y0: number, x1: number, y1: number, id: number) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(layer, x, y, id);
};
const free = (x: number, y: number, w = 1, h = 1) => {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++)
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || decor[at(xx, yy)] !== -1) return false;
  return true;
};

// Grass variety
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) if (hash(x, y, 11) < 0.12) set(ground, x, y, ids.grass2!);

// Paths and plaza
rect(ground, 2, 14, 39, 15, ids.path!);
rect(ground, 19, 2, 20, 27, ids.path!);
rect(ground, 14, 10, 25, 19, ids.plaza!);

/** A 2×2 tree. The canopy is walk-behind unless `solid` (used for the border, so nobody hides at the edge). */
function stampTree(x: number, y: number, solid = false) {
  if (!free(x, y + 1, 2, 1) || !free(x, y, 2, 1)) return;
  set(overhead, x, y, ids.treeTL!);
  set(overhead, x + 1, y, ids.treeTR!);
  set(decor, x, y + 1, ids.treeBL!);
  set(decor, x + 1, y + 1, ids.treeBR!);
  // Mark the canopy tiles as taken so nothing else is placed under them.
  set(decor, x, y, solid ? ids.blocker! : -2);
  set(decor, x + 1, y, solid ? ids.blocker! : -2);
}

function building(x0: number, y0: number, color: "Red" | "Blue" | "Green") {
  for (let y = y0; y < y0 + 3; y++) {
    set(decor, x0, y, ids[`roof${color}L`]!);
    for (let x = x0 + 1; x < x0 + 5; x++) set(decor, x, y, ids[`roof${color}M`]!);
    set(decor, x0 + 5, y, ids[`roof${color}R`]!);
  }
  const row1 = ["wall", "wallWindow", "wall", "wall", "wallWindow", "wall"];
  const row2 = ["wall", "wall", "wall", "door", "wall", "wall"];
  row1.forEach((n, i) => set(decor, x0 + i, y0 + 3, ids[n]!));
  row2.forEach((n, i) => set(decor, x0 + i, y0 + 4, ids[n]!));
  // A short path from the door.
  rect(ground, x0 + 3, y0 + 5, x0 + 3, y0 + 6, ids.path!);
}

// Buildings: café (top left), post office (top right), trading post (bottom right)
building(5, 4, "Red");
building(29, 4, "Blue");
building(29, 20, "Green");
rect(ground, 8, 11, 8, 13, ids.path!);
rect(ground, 32, 11, 32, 13, ids.path!);
rect(ground, 32, 16, 32, 19, ids.path!);

// Fountain and plaza furniture
[
  [19, 13],
  [20, 13],
  [19, 14],
  [20, 14],
].forEach(([x, y], i) => set(decor, x!, y!, ids[`fountain${i}`]!));
set(decor, 15, 11, ids.boardL!);
set(decor, 16, 11, ids.boardR!);
for (const [x, y] of [
  [14, 11],
  [25, 11],
  [14, 19],
  [25, 19],
]) {
  set(decor, x!, y!, ids.lampBottom!);
  set(overhead, x!, y! - 1, ids.lampTop!);
}
set(decor, 22, 11, ids.benchL!);
set(decor, 23, 11, ids.benchR!);
set(decor, 16, 18, ids.benchL!);
set(decor, 17, 18, ids.benchR!);
set(decor, 22, 18, ids.benchL!);
set(decor, 23, 18, ids.benchR!);

// Park with pond (bottom left)
rect(ground, 3, 20, 11, 25, ids.sand!);
rect(ground, 4, 21, 10, 24, ids.water!);
for (let y = 18; y < 28; y++)
  for (let x = 2; x < 14; x++) {
    if (ground[at(x, y)] !== ids.grass && ground[at(x, y)] !== ids.grass2) continue;
    const r = hash(x, y, 21);
    if (r < 0.12) set(ground, x, y, ids.flowersPink!);
    else if (r < 0.22) set(ground, x, y, ids.flowersYellow!);
  }
rect(ground, 2, 26, 6, 27, ids.tallGrass!);
set(decor, 12, 21, ids.benchL!);
set(decor, 13, 21, ids.benchR!);
set(decor, 12, 24, ids.bush!);
set(decor, 2, 19, ids.rock!);

// Home portal (bottom centre), where the main path ends
[
  [19, 24],
  [20, 24],
  [19, 25],
  [20, 25],
].forEach(([x, y], i) => set(decor, x!, y!, ids[`portal${i}`]!));
rect(ground, 19, 26, 20, 27, ids.grass!);

// Closed road to the Wilds (east edge)
rect(decor, 37, 12, 37, 17, ids.fence!);

// Café flower pots and bushes around buildings
set(decor, 4, 8, ids.pot!);
set(decor, 11, 8, ids.pot!);
set(decor, 28, 8, ids.bush!);
set(decor, 35, 8, ids.bush!);
set(decor, 28, 24, ids.pot!);
set(decor, 35, 24, ids.pot!);

// Signs
set(decor, 6, 10, ids.sign!);
set(decor, 30, 10, ids.sign!);
set(decor, 30, 26, ids.sign!);
set(decor, 21, 26, ids.sign!);
set(decor, 36, 13, ids.sign!);
set(decor, 13, 19, ids.sign!);

// Border trees (2×2), leaving the east road open up to the fence
for (let x = 0; x < W; x += 2) {
  stampTree(x, 0, true);
  stampTree(x, H - 2, true);
}
for (let y = 2; y < H - 2; y += 2) {
  stampTree(0, y, true);
  if (y < 12 || y > 16) stampTree(W - 2, y, true);
}
rect(decor, 38, 12, 39, 17, ids.bush!);
// A few trees dotted around
for (const [x, y] of [
  [2, 9],
  [12, 2],
  [24, 2],
  [15, 23],
  [24, 22],
  [36, 17],
  [26, 6],
])
  stampTree(x!, y!);

for (let i = 0; i < decor.length; i++) if (decor[i] === -2) decor[i] = -1;

// ---------- Objects ----------
let nextId = 1;
type Obj = { name: string; type: string; x: number; y: number; props?: Record<string, string | number> };
const objects: Obj[] = [];
const obj = (o: Obj) => objects.push(o);

for (const [x, y] of [
  [18, 16],
  [21, 16],
  [18, 17],
  [21, 17],
  [19, 17],
  [20, 17],
])
  obj({ name: "spawn", type: "spawn", x: x!, y: y! });

const sign = (x: number, y: number, text: string) =>
  obj({ name: "sign", type: "sign", x, y, props: { text } });
sign(6, 10, "CAFÉ\n\nOpening soon! Meet friends here for snacks and board games.");
sign(30, 10, "POST OFFICE\n\nOpening soon! Send letters and gifts to your friends' mailboxes.");
sign(30, 26, "TRADING POST\n\nOpening soon! Trade items with your friends here.");
sign(21, 26, "HOME PORTAL\n\nThis will take you home, and to your friends' homes. It isn't working yet.");
sign(
  36,
  13,
  "THE WILDS →\n\nThe road is closed for now.\n\nStrange creatures have been spotted beyond the fence…",
);
sign(13, 19, "TOWN PARK\n\nFishing and bug catching are coming soon.");
const board =
  "NOTICE BOARD\n\nWelcome to the Town Square!\n\nComing soon: friends, chat, letters, homes, and creatures to befriend in the Wilds.";
sign(15, 11, board);
sign(16, 11, board);
sign(19, 14, "The fountain sparkles. Someone has tossed a coin in.");
sign(20, 14, "The fountain sparkles. Someone has tossed a coin in.");
for (const [x, y, name] of [
  [8, 8, "CAFÉ"],
  [32, 8, "POST OFFICE"],
  [32, 24, "TRADING POST"],
] as const)
  sign(x, y, `${name}\n\nThe door is locked. It'll open soon!`);

const npc = (name: string, x: number, y: number, dir: string, seed: number, text: string) =>
  obj({ name, type: "npc", x, y, props: { dir, seed, text } });
npc(
  "Mayor Pip",
  17,
  15,
  "down",
  1201,
  "Oh! A new face! Welcome to Hearth.\n\nWalk with the arrow keys or the D-pad. Hold B or Shift to run.\n\nPress A, Z or Enter to talk to people and read signs.\n\nYour friends will be able to find you here soon!",
);
npc(
  "Fern",
  9,
  19,
  "left",
  5323,
  "I'm keeping the park tidy.\n\nI hear you'll be able to fish in this pond one day. I can't wait!",
);
npc(
  "Robin",
  33,
  11,
  "down",
  9004,
  "I'm the mail carrier! Well, I will be.\n\nOnce the post office opens, letters you send land in your friends' mailboxes.",
);

const tiledObjects = objects.map((o) => ({
  id: nextId++,
  name: o.name,
  type: o.type,
  x: o.x * T,
  y: o.y * T,
  width: 0,
  height: 0,
  point: true,
  rotation: 0,
  visible: true,
  properties: Object.entries(o.props ?? {}).map(([name, value]) => ({
    name,
    type: typeof value === "number" ? "int" : "string",
    value,
  })),
}));

const gid = (id: number) => (id < 0 ? 0 : id + 1);
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
    layer(2, "decor", decor),
    layer(3, "overhead", overhead),
    {
      id: 4,
      name: "objects",
      type: "objectgroup",
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      draworder: "topdown",
      objects: tiledObjects,
    },
  ],
  tilesets: [
    {
      firstgid: 1,
      name: "town",
      image: "../../../apps/client/public/tiles/town.png",
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
console.log(`Wrote ${tiles.length} tiles (${used.size} colors) and a ${W}×${H} map.`);
