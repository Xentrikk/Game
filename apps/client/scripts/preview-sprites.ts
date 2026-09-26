/**
 * Renders a contact sheet of random characters to preview.png, for reviewing placeholder art
 * without running the app. Run: pnpm --filter @hearth/client exec tsx scripts/preview-sprites.ts
 */
import { defaultAppearance, randomAppearance, type Appearance } from "@hearth/shared";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { layersFor, recolor, stack } from "../src/sprites/compose";
import { SHEET_H, SHEET_W } from "../src/sprites/format";

const root = dirname(fileURLToPath(import.meta.url));
const SCALE = Number(process.env.SCALE ?? 3);
const COUNT = Number(process.argv[2] ?? 6);
let seed = Number(process.argv[3] ?? 7);
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function compose(a: Appearance): Uint8Array {
  const out = new Uint8Array(SHEET_W * SHEET_H * 4);
  for (const layer of layersFor(a)) {
    const png = PNG.sync.read(readFileSync(join(root, "../public/sprites", layer.path)));
    const data = new Uint8Array(png.data);
    recolor(data, layer.colors);
    stack(out, data);
  }
  return out;
}

const chars = [defaultAppearance(), ...Array.from({ length: COUNT - 1 }, () => randomAppearance(rand))];
const W = SHEET_W * SCALE * chars.length + 8 * (chars.length + 1);
const Hh = SHEET_H * SCALE + 16;
const img = new PNG({ width: W, height: Hh });
for (let i = 0; i < img.data.length; i += 4) img.data.set([120, 168, 88, 255], i);
chars.forEach((a, n) => {
  const px = compose(a);
  const ox = 8 + n * (SHEET_W * SCALE + 8);
  for (let y = 0; y < SHEET_H; y++)
    for (let x = 0; x < SHEET_W; x++) {
      const i = (y * SHEET_W + x) * 4;
      if (!px[i + 3]) continue;
      for (let sy = 0; sy < SCALE; sy++)
        for (let sx = 0; sx < SCALE; sx++) {
          const o = ((8 + y * SCALE + sy) * W + ox + x * SCALE + sx) * 4;
          img.data.set([px[i]!, px[i + 1]!, px[i + 2]!, 255], o);
        }
    }
});
const file = process.argv[4] ?? join(root, "../preview.png");
writeFileSync(file, PNG.sync.write(img));
console.log(`Wrote ${file}`);
