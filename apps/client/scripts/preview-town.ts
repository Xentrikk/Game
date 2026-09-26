/** Renders the whole Town Square map (all layers) to a PNG for review. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(join(root, "../../../packages/shared/maps/town.json"), "utf8"));
const sheet = PNG.sync.read(readFileSync(join(root, "../public/tiles/town.png")));
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
// Mark objects: spawns (white), signs (yellow), NPCs (magenta)
const objects = map.layers.find((l: { type: string }) => l.type === "objectgroup").objects;
for (const o of objects) {
  const color = o.type === "spawn" ? [255, 255, 255] : o.type === "npc" ? [255, 0, 255] : [255, 255, 0];
  for (let y = 6; y < 10; y++)
    for (let x = 6; x < 10; x++) out.data.set([...color, 255], ((o.y + y) * out.width + o.x + x) * 4);
}
const file = process.argv[2] ?? join(root, "../town-preview.png");
writeFileSync(file, PNG.sync.write(out));
console.log(`Wrote ${file}`);
