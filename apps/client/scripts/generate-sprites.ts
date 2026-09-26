/**
 * Generates PLACEHOLDER character sprite sheets in the key-color format from src/sprites/format.ts.
 * Real art can replace any sheet file-for-file (see docs/art-pipeline.md).
 *
 * Run: pnpm sprites  (writes apps/client/public/sprites/**)
 */
import { ACCESSORIES, BODIES, BOTTOMS, EYE_STYLES, HAIR_STYLES, SHOES, TOPS } from "@hearth/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  DIRECTIONS,
  FRAMES,
  FRAME_H,
  FRAME_W,
  KEY,
  OUTLINE,
  SHEET_H,
  SHEET_W,
  WHITE,
  sheetPath,
  type LayerKind,
} from "../src/sprites/format";

type RGB = readonly [number, number, number];
type View = "down" | "left" | "up";
type Painter = {
  px(x: number, y: number, c: RGB): void;
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void;
};

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../public/sprites");

// ---------- Geometry shared by all layers so arms, legs and clothes line up ----------

interface Leg {
  x0: number;
  x1: number;
  bottom: number;
}
interface Geom {
  view: View;
  frame: number;
  torso: [number, number];
  arms: { x0: number; x1: number; top: number }[];
  legs: Leg[];
}

const TORSO: Record<string, { front: [number, number]; side: [number, number] }> = {
  slim: { front: [5, 10], side: [6, 10] },
  average: { front: [4, 11], side: [5, 10] },
  broad: { front: [3, 12], side: [5, 11] },
};

function geom(view: View, frame: number, body: string): Geom {
  const t = TORSO[body] ?? TORSO.average!;
  // Frame 1 and 3 are the two steps; one leg lifts by a pixel and the opposite arm swings forward.
  const liftL = frame === 3 ? -1 : 0;
  const liftR = frame === 1 ? -1 : 0;
  if (view === "left") {
    const torso = t.side;
    const armX = frame === 1 ? 6 : frame === 3 ? 9 : 7;
    const legs: Leg[] =
      frame === 1 || frame === 3
        ? [
            { x0: 5, x1: 7, bottom: 21 },
            { x0: 8, x1: 10, bottom: 20 },
          ]
        : [{ x0: 6, x1: 9, bottom: 21 }];
    return { view, frame, torso, arms: [{ x0: armX, x1: armX + 1, top: 14 }], legs };
  }
  const torso = t.front;
  return {
    view,
    frame,
    torso,
    arms: [
      { x0: torso[0] - 1, x1: torso[0] - 1, top: 14 + (view === "down" ? liftR : liftL) },
      { x0: torso[1] + 1, x1: torso[1] + 1, top: 14 + (view === "down" ? liftL : liftR) },
    ],
    legs: [
      { x0: torso[0] + 1, x1: 7, bottom: 21 + liftL },
      { x0: 8, x1: torso[1] - 1, bottom: 21 + liftR },
    ],
  };
}

// ---------- Sheet building ----------

class Sheet {
  data = new Uint8Array(SHEET_W * SHEET_H * 4);

  painter(col: number, row: number): Painter {
    const ox = col * FRAME_W;
    const oy = row * FRAME_H;
    const px = (x: number, y: number, c: RGB) => {
      if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) return;
      const i = ((oy + y) * SHEET_W + ox + x) * 4;
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
    };
    return {
      px,
      rect(x0, y0, x1, y1, c) {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
      },
    };
  }

  private alpha(x: number, y: number) {
    return this.data[(y * SHEET_W + x) * 4 + 3]!;
  }

  /** Adds a 1px dark outline around everything drawn in each frame. */
  outline() {
    const add: [number, number][] = [];
    for (let row = 0; row < DIRECTIONS.length; row++) {
      for (let col = 0; col < FRAMES; col++) {
        for (let y = 0; y < FRAME_H; y++) {
          for (let x = 0; x < FRAME_W; x++) {
            const gx = col * FRAME_W + x;
            const gy = row * FRAME_H + y;
            if (this.alpha(gx, gy)) continue;
            const near = [
              [x - 1, y],
              [x + 1, y],
              [x, y - 1],
              [x, y + 1],
            ].some(
              ([nx, ny]) =>
                nx! >= 0 &&
                ny! >= 0 &&
                nx! < FRAME_W &&
                ny! < FRAME_H &&
                this.alpha(col * FRAME_W + nx!, row * FRAME_H + ny!),
            );
            if (near) add.push([gx, gy]);
          }
        }
      }
    }
    for (const [gx, gy] of add) {
      const i = (gy * SHEET_W + gx) * 4;
      this.data.set([...OUTLINE, 255], i);
    }
  }

  /** Fills the "right" row by mirroring the "left" row. */
  mirrorLeftToRight() {
    const left = DIRECTIONS.indexOf("left");
    const right = DIRECTIONS.indexOf("right");
    for (let col = 0; col < FRAMES; col++) {
      for (let y = 0; y < FRAME_H; y++) {
        for (let x = 0; x < FRAME_W; x++) {
          const src = ((left * FRAME_H + y) * SHEET_W + col * FRAME_W + x) * 4;
          const dst = ((right * FRAME_H + y) * SHEET_W + col * FRAME_W + (FRAME_W - 1 - x)) * 4;
          this.data.copyWithin(dst, src, src + 4);
        }
      }
    }
  }

  write(relPath: string) {
    const png = new PNG({ width: SHEET_W, height: SHEET_H });
    png.data = Buffer.from(this.data);
    const file = join(OUT_DIR, relPath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, PNG.sync.write(png));
  }
}

type DrawFn = (p: Painter, g: Geom) => void;

function buildSheet(body: string, draw: DrawFn, outline: boolean): Sheet {
  const sheet = new Sheet();
  const views: [View, number][] = [
    ["down", DIRECTIONS.indexOf("down")],
    ["left", DIRECTIONS.indexOf("left")],
    ["up", DIRECTIONS.indexOf("up")],
  ];
  for (const [view, row] of views) {
    for (let col = 0; col < FRAMES; col++) draw(sheet.painter(col, row), geom(view, col, body));
  }
  if (outline) sheet.outline();
  sheet.mirrorLeftToRight();
  return sheet;
}

let written = 0;
function emit(kind: LayerKind, id: string, body: string, draw: DrawFn, outline = true) {
  buildSheet(body, draw, outline).write(sheetPath(kind, id, body));
  written++;
}

// ---------- Body ----------

const HEAD_ROWS: [number, number, number][] = [
  [3, 5, 10],
  [4, 4, 11],
  [5, 3, 12],
  [6, 3, 12],
  [7, 3, 12],
  [8, 3, 12],
  [9, 3, 12],
  [10, 3, 12],
  [11, 3, 12],
  [12, 4, 11],
];

const drawBody: DrawFn = (p, g) => {
  for (const [y, x0, x1] of HEAD_ROWS) p.rect(x0, y, x1, y, KEY.skin);
  if (g.view === "down") {
    p.rect(12, 5, 12, 11, KEY.skinShade);
    p.rect(10, 12, 11, 12, KEY.skinShade);
  }
  if (g.view === "left") p.rect(11, 5, 12, 11, KEY.skinShade);
  p.rect(7, 13, 8, 13, KEY.skinShade);
  p.rect(g.torso[0], 14, g.torso[1], 18, KEY.skin);
  for (const leg of g.legs) p.rect(leg.x0, 19, leg.x1, leg.bottom, KEY.skin);
  for (const arm of g.arms) {
    p.rect(arm.x0, arm.top, arm.x1, arm.top + 4, KEY.skin);
    p.rect(arm.x0, arm.top + 4, arm.x1, arm.top + 4, KEY.skinShade);
  }
};

// ---------- Eyes ----------

/** 2×3 patterns for the left eye (rows 7–9). E = eye color, W = white, O = outline. Right eye is mirrored. */
const EYES: Record<string, string[]> = {
  round: ["  ", "WE", "EE"],
  happy: ["  ", "OO", "  "],
  sleepy: ["  ", "OO", "WE"],
  sharp: ["O ", "WE", "E "],
  wide: ["WE", "EE", "EE"],
  lashes: ["OO", "WE", "EE"],
  dot: ["  ", "WE", "  "],
  bold: ["OO", "WE", "EE"],
};

function eyeDraw(style: string): DrawFn {
  const pattern = EYES[style]!;
  const color = (ch: string): RGB | null =>
    ch === "E" ? KEY.eye : ch === "W" ? WHITE : ch === "O" ? OUTLINE : null;
  const stamp = (p: Painter, x0: number, mirror: boolean) => {
    pattern.forEach((line, dy) => {
      for (let dx = 0; dx < 2; dx++) {
        const c = color(line[mirror ? 1 - dx : dx]!);
        if (c) p.px(x0 + dx, 7 + dy, c);
      }
    });
  };
  return (p, g) => {
    if (g.view === "down") {
      stamp(p, 5, false);
      stamp(p, 9, true);
    } else if (g.view === "left") {
      stamp(p, 4, false);
    }
  };
}

// ---------- Hair ----------

interface HairStyle {
  cap?: boolean;
  /** Last row the hair reaches down the sides of the face. */
  sides: number;
  /** Extra width of side hair (1 = hugs the head, 2 = puffier). */
  sideWidth?: number;
  /** Bang pixels on rows 6–7 as [row, x0, x1]. */
  bangs: [number, number, number][];
  /** How far long hair falls behind the body (0 = none). */
  back?: number;
  extra?: (p: Painter, g: Geom, layer: "front" | "back") => void;
}

const H = KEY.hair;
const HS = KEY.hairShade;

function drawCap(p: Painter, g: Geom) {
  p.rect(5, 2, 10, 2, H);
  p.rect(4, 3, 11, 3, H);
  p.rect(3, 4, 12, 5, H);
  if (g.view === "down") p.rect(12, 4, 12, 5, HS);
}

const HAIR: Record<string, HairStyle> = {
  short: {
    sides: 8,
    bangs: [
      [6, 4, 6],
      [6, 8, 11],
    ],
  },
  spiky: {
    sides: 7,
    bangs: [
      [6, 4, 4],
      [6, 6, 6],
      [6, 9, 9],
      [6, 11, 11],
    ],
    extra: (p, _g, layer) => {
      if (layer !== "front") return;
      for (const x of [4, 7, 10]) p.rect(x, 1, x + 1, 1, H);
      for (const x of [4, 8, 11]) p.px(x, 0, H);
    },
  },
  bob: {
    sides: 12,
    sideWidth: 2,
    bangs: [
      [6, 4, 11],
      [7, 4, 4],
      [7, 11, 11],
    ],
  },
  long: {
    sides: 12,
    bangs: [
      [6, 4, 6],
      [6, 9, 11],
    ],
    back: 18,
  },
  ponytail: {
    sides: 8,
    bangs: [
      [6, 4, 6],
      [6, 8, 11],
    ],
    extra: (p, g, layer) => {
      if (layer !== "front") return;
      if (g.view === "down") p.rect(13, 4, 14, 10, H);
      if (g.view === "left") p.rect(12, 5, 14, 13, H);
      if (g.view === "up") p.rect(7, 11, 8, 16, H);
    },
  },
  pigtails: {
    sides: 8,
    bangs: [[6, 4, 11]],
    extra: (p, g, layer) => {
      if (layer !== "front") return;
      if (g.view === "left") return void p.rect(12, 7, 13, 13, H);
      p.rect(1, 7, 2, 13, H);
      p.rect(13, 7, 14, 13, H);
    },
  },
  curly: {
    sides: 10,
    sideWidth: 2,
    bangs: [
      [6, 3, 12],
      [7, 3, 3],
      [7, 6, 6],
      [7, 9, 9],
      [7, 12, 12],
    ],
    extra: (p, _g, layer) => {
      if (layer !== "front") return;
      for (const x of [4, 6, 8, 10]) p.px(x, 1, H);
    },
  },
  puff: {
    sides: 8,
    sideWidth: 2,
    bangs: [
      [6, 3, 5],
      [6, 7, 8],
      [6, 10, 12],
    ],
    extra: (p, _g, layer) => {
      if (layer !== "front") return;
      p.rect(5, 0, 10, 0, H);
      p.rect(3, 1, 12, 1, H);
      p.rect(2, 2, 13, 5, H);
    },
  },
  mohawk: {
    cap: false,
    sides: 0,
    bangs: [],
    extra: (p, g, layer) => {
      if (layer !== "front") return;
      p.rect(7, 0, 8, 5, H);
      p.rect(6, 2, 9, 4, H);
      if (g.view !== "left") {
        p.rect(3, 5, 3, 7, HS);
        p.rect(12, 5, 12, 7, HS);
      } else {
        p.rect(9, 5, 12, 7, HS);
      }
      if (g.view === "up") p.rect(7, 6, 8, 11, H);
    },
  },
  sidepart: {
    sides: 9,
    bangs: [
      [6, 3, 8],
      [7, 3, 5],
      [6, 11, 12],
    ],
  },
  bun: {
    sides: 7,
    bangs: [
      [6, 4, 5],
      [6, 10, 11],
    ],
    extra: (p, _g, layer) => {
      if (layer !== "front") return;
      p.rect(7, 0, 8, 0, H);
      p.rect(6, 1, 9, 2, H);
    },
  },
  buzz: {
    cap: false,
    sides: 0,
    bangs: [],
    extra: (p, g, layer) => {
      if (layer !== "front") return;
      p.rect(5, 3, 10, 3, HS);
      p.rect(4, 4, 11, 4, HS);
      if (g.view === "left") p.rect(9, 5, 12, 7, HS);
      if (g.view === "up") p.rect(3, 5, 12, 10, HS);
    },
  },
};

function hairDraw(style: string, layer: "front" | "back"): DrawFn {
  const s = HAIR[style]!;
  const width = s.sideWidth ?? 1;
  return (p, g) => {
    if (layer === "back") {
      if (!s.back || g.view === "up") return;
      if (g.view === "down") {
        p.rect(2, 8, 3, s.back, H);
        p.rect(12, 8, 13, s.back, H);
        p.rect(13, 8, 13, s.back, HS);
      } else {
        p.rect(10, 8, 13, s.back, H);
      }
      return;
    }
    if (s.cap !== false) {
      drawCap(p, g);
      if (g.view === "down") {
        for (const [y, x0, x1] of s.bangs) p.rect(x0, y, x1, y, H);
        if (s.sides > 5) {
          p.rect(4 - width, 5, 3, s.sides, H);
          p.rect(12, 5, 11 + width, s.sides, HS);
        }
      } else if (g.view === "left") {
        p.rect(3, 6, 5, 6, H);
        if (s.bangs.some(([y]) => y === 7)) p.rect(3, 7, 4, 7, H);
        p.rect(9, 5, 12, Math.max(s.sides, 7), H);
        p.rect(12, 5, 11 + width, Math.max(s.sides, 7), HS);
      } else {
        // From behind, the hair covers the whole head, plus long hair down the back.
        for (const [y, x0, x1] of HEAD_ROWS) if (y <= Math.max(s.sides, 10)) p.rect(x0, y, x1, y, H);
        p.rect(3, 5, 12, Math.max(s.sides, 10), H);
        if (width > 1) p.rect(2, 6, 13, s.sides, H);
        if (s.back) {
          p.rect(4, 11, 11, s.back - 2, H);
          p.rect(5, s.back - 1, 10, s.back - 1, H);
          p.rect(7, 11, 8, s.back - 2, HS);
        }
        p.rect(3, Math.max(s.sides, 10), 12, Math.max(s.sides, 10), HS);
      }
    }
    s.extra?.(p, g, layer);
  };
}

// ---------- Tops ----------

const S0 = KEY.slot0;
const S0S = KEY.slot0Shade;
const S1 = KEY.slot1;
const S2 = KEY.slot2;

type Sleeve = "short" | "long" | "none";
const TOP_SHAPES: Record<string, { sleeve: Sleeve; detail?: (p: Painter, g: Geom) => void }> = {
  tee: { sleeve: "short", detail: (p, g) => g.view === "down" && p.rect(7, 13, 8, 13, S1) },
  striped: {
    sleeve: "short",
    detail: (p, g) => {
      for (const y of [14, 16]) p.rect(g.torso[0], y, g.torso[1], y, S1);
      for (const arm of g.arms) p.px(arm.x0, arm.top, S1);
    },
  },
  longsleeve: {
    sleeve: "long",
    detail: (p, g) => {
      for (const arm of g.arms) p.rect(arm.x0, arm.top + 3, arm.x1, arm.top + 3, S1);
      if (g.view === "down") p.rect(7, 13, 8, 13, S1);
    },
  },
  hoodie: {
    sleeve: "long",
    detail: (p, g) => {
      if (g.view === "down") {
        p.rect(6, 16, 9, 17, S1);
        p.rect(6, 14, 6, 15, S2);
        p.rect(9, 14, 9, 15, S2);
        p.rect(5, 13, 6, 13, S0);
        p.rect(9, 13, 10, 13, S0);
      } else if (g.view === "up") {
        p.rect(5, 13, 10, 14, S1);
      } else {
        p.rect(9, 12, 11, 14, S1);
      }
    },
  },
  jacket: {
    sleeve: "long",
    detail: (p, g) => {
      if (g.view === "down") {
        p.rect(7, 13, 8, 17, S1);
        p.px(7, 15, S2);
        p.px(7, 17, S2);
      }
      if (g.view === "left") p.rect(g.torso[0], 14, g.torso[0], 17, S2);
    },
  },
  tank: { sleeve: "none" },
  sweater: {
    sleeve: "long",
    detail: (p, g) => {
      for (let x = g.torso[0]; x <= g.torso[1]; x++) p.px(x, x % 2 ? 15 : 16, S1);
    },
  },
  vest: {
    sleeve: "short",
    detail: (p, g) => {
      if (g.view === "down") {
        p.rect(7, 13, 8, 17, S1);
        p.px(6, 15, S2);
        p.px(6, 17, S2);
      } else {
        for (const arm of g.arms) p.rect(arm.x0, arm.top, arm.x1, arm.top + 1, S1);
      }
    },
  },
  polo: {
    sleeve: "short",
    detail: (p, g) => {
      if (g.view !== "down") return;
      p.rect(5, 13, 6, 13, S1);
      p.rect(9, 13, 10, 13, S1);
      p.px(7, 14, S2);
      p.px(7, 15, S2);
    },
  },
  robe: {
    sleeve: "long",
    detail: (p, g) => {
      if (g.view === "down") for (let i = 0; i < 4; i++) p.px(6 + i, 13 + i, S1);
      p.rect(g.torso[0], 17, g.torso[1], 17, S2);
      for (const arm of g.arms) p.rect(arm.x0, arm.top + 3, arm.x1, arm.top + 3, S1);
    },
  },
};

function topDraw(id: string): DrawFn {
  const shape = TOP_SHAPES[id]!;
  return (p, g) => {
    const [x0, x1] = g.torso;
    if (shape.sleeve === "none") {
      p.rect(x0, 14, x1, 17, S0);
      p.px(x0 + 1, 13, S0);
      p.px(x1 - 1, 13, S0);
    } else {
      p.rect(x0, 13, x1, 17, S0);
      const len = shape.sleeve === "long" ? 3 : 1;
      for (const arm of g.arms) p.rect(arm.x0, arm.top, arm.x1, arm.top + len, S0);
    }
    if (g.view === "down") p.rect(x1, 14, x1, 17, S0S);
    shape.detail?.(p, g);
  };
}

// ---------- Bottoms ----------

const BOTTOM_SHAPES: Record<string, (p: Painter, g: Geom) => void> = {
  shorts: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 18, S0);
    for (const l of g.legs) {
      p.rect(l.x0, 19, l.x1, 19, S0);
      p.rect(l.x0, 20, l.x1, 20, S1);
    }
  },
  jeans: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 18, S0);
    for (const l of g.legs) {
      p.rect(l.x0, 19, l.x1, l.bottom, S0);
      p.rect(l.x0, l.bottom, l.x1, l.bottom, S1);
    }
  },
  skirt: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 19, S0);
    p.rect(g.torso[0] - 1, 20, g.torso[1] + 1, 20, S1);
  },
  longskirt: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 18, S1);
    p.rect(g.torso[0], 19, g.torso[1], 20, S0);
    p.rect(g.torso[0] - 1, 21, g.torso[1] + 1, 21, S0);
  },
  cargo: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 18, S2);
    for (const l of g.legs) {
      p.rect(l.x0, 19, l.x1, l.bottom, S0);
      p.px(l.x0, 20, S1);
    }
  },
  patched: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 18, S0);
    for (const l of g.legs) {
      p.rect(l.x0, 19, l.x1, l.bottom, S0);
      p.px(l.x1, 19, S1);
      p.rect(l.x0, l.bottom, l.x1, l.bottom, S2);
    }
  },
  leggings: (p, g) => {
    p.rect(g.torso[0] + 1, 18, g.torso[1] - 1, 18, S0);
    for (const l of g.legs) {
      p.rect(l.x0, 19, l.x1, l.bottom, S0);
      p.rect(l.x0, 19, l.x0, l.bottom, S1);
    }
  },
  joggers: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 18, S0);
    for (const l of g.legs) {
      p.rect(l.x0, 19, l.x1, l.bottom, S0);
      p.rect(l.x0, l.bottom, l.x1, l.bottom, S1);
    }
  },
  pleated: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 20, S0);
    for (let x = g.torso[0] + 1; x <= g.torso[1]; x += 2) p.rect(x, 19, x, 20, S1);
  },
  wide: (p, g) => {
    p.rect(g.torso[0], 18, g.torso[1], 18, S0);
    for (const l of g.legs) {
      p.rect(
        l.x0 - (g.view === "left" ? 0 : l.x0 < 8 ? 1 : 0),
        19,
        l.x1 + (l.x0 >= 8 && g.view !== "left" ? 1 : 0),
        l.bottom,
        S0,
      );
      p.px(l.x0 < 8 ? l.x1 : l.x0, 20, S1);
    }
  },
};

// ---------- Shoes ----------

const SHOE_SHAPES: Record<string, (p: Painter, l: Leg, g: Geom) => void> = {
  sneakers: (p, l) => {
    p.rect(l.x0, l.bottom + 1, l.x1, l.bottom + 1, S0);
    p.rect(l.x0, l.bottom + 2, l.x1, l.bottom + 2, S1);
  },
  boots: (p, l) => {
    p.rect(l.x0, l.bottom, l.x1, l.bottom + 1, S0);
    p.rect(l.x0, l.bottom + 2, l.x1, l.bottom + 2, S1);
  },
  sandals: (p, l) => {
    p.rect(l.x0, l.bottom + 1, l.x1, l.bottom + 1, KEY.skin);
    p.px(Math.floor((l.x0 + l.x1) / 2), l.bottom + 1, S0);
    p.rect(l.x0, l.bottom + 2, l.x1, l.bottom + 2, S1);
  },
  loafers: (p, l) => {
    p.rect(l.x0, l.bottom + 1, l.x1, l.bottom + 2, S0);
    p.px(Math.floor((l.x0 + l.x1) / 2), l.bottom + 1, S1);
  },
  rainboots: (p, l) => {
    p.rect(l.x0, l.bottom - 1, l.x1, l.bottom - 1, S1);
    p.rect(l.x0, l.bottom, l.x1, l.bottom + 2, S0);
  },
  hightops: (p, l) => {
    p.rect(l.x0, l.bottom, l.x1, l.bottom + 1, S0);
    p.px(l.x0, l.bottom + 1, S2);
    p.rect(l.x0, l.bottom + 2, l.x1, l.bottom + 2, S1);
  },
};

function shoesDraw(id: string): DrawFn {
  const shape = SHOE_SHAPES[id]!;
  return (p, g) => {
    for (const leg of g.legs) {
      // In side view the toe pokes forward one pixel.
      shape(p, g.view === "left" ? { ...leg, x0: leg.x0 - 1 } : leg, g);
    }
  };
}

// ---------- Accessories ----------

const ACCESSORY_SHAPES: Record<string, { outline: boolean; draw: DrawFn }> = {
  cap: {
    outline: true,
    draw: (p, g) => {
      p.rect(5, 1, 10, 1, S0);
      p.rect(4, 2, 11, 4, S0);
      if (g.view === "down") p.rect(3, 5, 12, 5, S1);
      if (g.view === "left") p.rect(1, 5, 7, 5, S1);
      if (g.view === "up") p.rect(6, 5, 9, 5, S1);
    },
  },
  beanie: {
    outline: true,
    draw: (p) => {
      p.rect(5, 1, 10, 1, S0);
      p.rect(4, 2, 11, 2, S0);
      p.rect(3, 3, 12, 4, S0);
      p.rect(3, 5, 12, 5, S1);
      p.rect(7, 0, 8, 0, S1);
    },
  },
  glasses: {
    outline: false,
    draw: (p, g) => {
      if (g.view === "down") {
        for (const x0 of [4, 8]) {
          p.rect(x0, 7, x0 + 3, 7, S0);
          p.rect(x0, 8, x0, 9, S1);
          p.rect(x0 + 3, 8, x0 + 3, 9, S1);
          p.rect(x0, 10, x0 + 3, 10, S0);
        }
      } else if (g.view === "left") {
        p.rect(3, 7, 6, 7, S0);
        p.rect(3, 10, 6, 10, S0);
        p.rect(6, 8, 6, 9, S1);
        p.rect(7, 8, 10, 8, S0);
      }
    },
  },
  sunglasses: {
    outline: false,
    draw: (p, g) => {
      if (g.view === "down") {
        p.rect(4, 8, 11, 9, S0);
        p.px(5, 8, S1);
        p.px(9, 8, S1);
      } else if (g.view === "left") {
        p.rect(3, 8, 6, 9, S0);
        p.px(4, 8, S1);
        p.rect(7, 8, 10, 8, S0);
      }
    },
  },
  flower: {
    outline: true,
    draw: (p, g) => {
      const cx = g.view === "up" ? 4 : g.view === "left" ? 9 : 11;
      p.px(cx, 2, S0);
      p.px(cx - 1, 3, S0);
      p.px(cx + 1, 3, S0);
      p.px(cx, 4, S0);
      p.px(cx, 3, S1);
    },
  },
  bow: {
    outline: true,
    draw: (p, g) => {
      const x = g.view === "left" ? 8 : 9;
      p.rect(x, 1, x + 1, 3, S0);
      p.rect(x + 3, 1, x + 4, 3, S0);
      p.px(x + 2, 2, S1);
    },
  },
  headband: {
    outline: false,
    draw: (p, g) => {
      p.rect(3, 4, 12, 4, S0);
      if (g.view === "down") p.rect(7, 4, 8, 4, S1);
    },
  },
  wizard: {
    outline: true,
    draw: (p) => {
      p.px(8, 0, S0);
      p.rect(7, 1, 8, 1, S0);
      p.rect(6, 2, 9, 2, S0);
      p.rect(5, 3, 10, 3, S0);
      p.rect(4, 4, 11, 4, S1);
      p.rect(2, 5, 13, 5, S0);
      p.px(7, 2, S2);
    },
  },
};

// ---------- Emit every sheet ----------

for (const body of BODIES) emit("body", body.id, body.id, drawBody);
for (const eye of EYE_STYLES) emit("eyes", eye.id, "", eyeDraw(eye.id), false);
for (const hair of HAIR_STYLES) {
  emit("hairFront", hair.id, "", hairDraw(hair.id, "front"));
  emit("hairBack", hair.id, "", hairDraw(hair.id, "back"));
}
for (const body of BODIES) {
  for (const top of TOPS) emit("top", top.id, body.id, topDraw(top.id));
  for (const bottom of BOTTOMS) emit("bottom", bottom.id, body.id, BOTTOM_SHAPES[bottom.id]!);
  for (const shoe of SHOES) emit("shoes", shoe.id, body.id, shoesDraw(shoe.id));
}
for (const acc of ACCESSORIES) {
  const shape = ACCESSORY_SHAPES[acc.id]!;
  emit("accessory", acc.id, "", shape.draw, shape.outline);
}

const missing = [
  ...TOPS.filter((t) => !TOP_SHAPES[t.id]),
  ...BOTTOMS.filter((b) => !BOTTOM_SHAPES[b.id]),
  ...SHOES.filter((s) => !SHOE_SHAPES[s.id]),
  ...ACCESSORIES.filter((a) => !ACCESSORY_SHAPES[a.id]),
  ...HAIR_STYLES.filter((h) => !HAIR[h.id]),
  ...EYE_STYLES.filter((e) => !EYES[e.id]),
];
if (missing.length) throw new Error(`No placeholder art for: ${missing.map((m) => m.id).join(", ")}`);
console.log(`Wrote ${written} sprite sheets to ${OUT_DIR}`);
