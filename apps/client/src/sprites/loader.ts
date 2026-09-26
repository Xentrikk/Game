import type { Appearance } from "@hearth/shared";
import { SHEET_H, SHEET_W } from "./format";
import { layersFor, recolor, stack } from "./compose";

const imageCache = new Map<string, Promise<ImageData>>();

function loadSheet(path: string): Promise<ImageData> {
  let p = imageCache.get(path);
  if (!p) {
    p = new Promise<ImageData>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = SHEET_W;
        c.height = SHEET_H;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, SHEET_W, SHEET_H));
      };
      img.onerror = () => reject(new Error(`Could not load sprite sheet ${path}`));
      img.src = `${import.meta.env.BASE_URL}sprites/${path}`;
    });
    imageCache.set(path, p);
  }
  return p;
}

/** Builds the full character sprite sheet (4 directions × 4 frames) for an appearance. */
export async function composeCharacter(appearance: Appearance): Promise<HTMLCanvasElement> {
  const layers = layersFor(appearance);
  const sheets = await Promise.all(layers.map((l) => loadSheet(l.path)));
  const out = new ImageData(SHEET_W, SHEET_H);
  sheets.forEach((sheet, i) => {
    const copy = new Uint8ClampedArray(sheet.data);
    recolor(copy, layers[i]!.colors);
    stack(out.data, copy);
  });
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  canvas.getContext("2d")!.putImageData(out, 0, 0);
  return canvas;
}

/** Loads every sheet an appearance needs ahead of time, so switching options doesn't flicker. */
export function preload(paths: string[]): void {
  for (const p of paths) void loadSheet(p).catch(() => undefined);
}
