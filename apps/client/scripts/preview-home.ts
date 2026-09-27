/** Renders a home interior map (all layers) to a PNG for review. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(join(root, "../../../packages/shared/maps/home.json"), "utf8"));
const sheet = PNG.sync.read(readFileSync(join(root, "../public/tiles/home.png")));
const T = 16;
const cols = map.tilesets[0].columns;
const out = new PNG({ width: map.width * T, height: map.height * T });
for (const layer of map.layers) {
  if (layer.type !== "tilelayer") continue;
  layer.data.forEach((gid: number, i: number) => {
    if (!gid) return;
    const id = gid - 1;
    const sx = (id % cols) * T;
    const sy = Math.floor(id / cols) * T;
    const dx = (i % map.width) * T;
    const dy = Math.floor(i / map.width) * T;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const s = ((sy + y) * sheet.width + sx + x) * 4;
        if (!sheet.data[s + 3]) continue;
        const d = ((dy + y) * out.width + dx + x) * 4;
        out.data.set(sheet.data.subarray(s, s + 4), d);
      }
  });
}
const file = process.argv[2] ?? join(root, "../home-preview.png");
writeFileSync(file, PNG.sync.write(out));
console.log(`Wrote ${file}`);
