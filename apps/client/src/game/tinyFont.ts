/**
 * A 3×5 pixel font for name tags. At 320×180 a normal 8px font would make a 12-letter name
 * take up a third of the screen; this keeps tags to 4px per letter. Letters are drawn in one
 * case, plus digits and a few symbols. Each glyph is five rows of three pixels.
 */
const GLYPHS: Record<string, [string, string, string, string, string]> = {
  a: [".#.", "#.#", "###", "#.#", "#.#"],
  b: ["##.", "#.#", "##.", "#.#", "##."],
  c: [".##", "#..", "#..", "#..", ".##"],
  d: ["##.", "#.#", "#.#", "#.#", "##."],
  e: ["###", "#..", "##.", "#..", "###"],
  f: ["###", "#..", "##.", "#..", "#.."],
  g: [".##", "#..", "#.#", "#.#", ".##"],
  h: ["#.#", "#.#", "###", "#.#", "#.#"],
  i: ["###", ".#.", ".#.", ".#.", "###"],
  j: ["..#", "..#", "..#", "#.#", ".#."],
  k: ["#.#", "#.#", "##.", "#.#", "#.#"],
  l: ["#..", "#..", "#..", "#..", "###"],
  m: ["#.#", "###", "###", "#.#", "#.#"],
  n: ["##.", "#.#", "#.#", "#.#", "#.#"],
  o: [".#.", "#.#", "#.#", "#.#", ".#."],
  p: ["##.", "#.#", "##.", "#..", "#.."],
  q: [".#.", "#.#", "#.#", "##.", ".##"],
  r: ["##.", "#.#", "##.", "#.#", "#.#"],
  s: [".##", "#..", ".#.", "..#", "##."],
  t: ["###", ".#.", ".#.", ".#.", ".#."],
  u: ["#.#", "#.#", "#.#", "#.#", ".##"],
  v: ["#.#", "#.#", "#.#", ".#.", ".#."],
  w: ["#.#", "#.#", "###", "###", "#.#"],
  x: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  _: ["...", "...", "...", "...", "###"],
  "-": ["...", "...", "###", "...", "..."],
  ".": ["...", "...", "...", "...", ".#."],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  "'": [".#.", ".#.", "...", "...", "..."],
};

export const TINY_FONT_HEIGHT = 5;
const ADVANCE = 4;
const SPACE_ADVANCE = 2;

export function isTinyFontText(text: string): boolean {
  return [...text.toLowerCase()].every((c) => c === " " || c in GLYPHS);
}

export function measureTiny(text: string): number {
  let w = 0;
  for (const c of text) w += c === " " ? SPACE_ADVANCE : ADVANCE;
  return Math.max(0, w - 1);
}

/** The lit pixels of `text`, offset by (ox, oy). */
export function tinyPixels(text: string, ox = 0, oy = 0): [number, number][] {
  const pixels: [number, number][] = [];
  let x = ox;
  for (const ch of text.toLowerCase()) {
    const glyph = GLYPHS[ch];
    if (glyph)
      glyph.forEach((row, ry) => [...row].forEach((p, rx) => p === "#" && pixels.push([x + rx, oy + ry])));
    x += ch === " " ? SPACE_ADVANCE : ADVANCE;
  }
  return pixels;
}

/** Draws text with a 1px dark outline onto a new canvas sized to fit. */
export function renderTinyText(text: string, color = "#f4f4f0", outline = "#1a1420"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, measureTiny(text) + 2);
  canvas.height = TINY_FONT_HEIGHT + 2;
  const ctx = canvas.getContext("2d")!;
  const pixels = tinyPixels(text, 1, 1);
  ctx.fillStyle = outline;
  for (const [x, y] of pixels) ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = color;
  for (const [x, y] of pixels) ctx.fillRect(x, y, 1, 1);
  return canvas;
}
