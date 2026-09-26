import { expect, type Page } from "@playwright/test";
import { DIRECTIONS, parseMap, tryStep, type Dir, type TiledMap } from "@hearth/shared";
import town from "@hearth/shared/maps/town.json" with { type: "json" };

export const townMap = parseMap(town as TiledMap);

export interface Snapshot {
  self: { x: number; y: number; dir: string; seq: number; px: { x: number; y: number } } | null;
  others: { id: string; handle?: string; x: number; y: number; dir: string; px: { x: number; y: number } }[];
  pocket: boolean;
  tint: number;
  fps: number;
}

export const snapshot = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __hearth: { snapshot(): unknown } }).__hearth.snapshot(),
  ) as Promise<Snapshot>;

export async function enterTown(page: Page) {
  await page.getByRole("button", { name: "Enter the Town Square" }).click();
  await expect
    .poll(async () => (await snapshot(page).catch(() => null))?.self, { timeout: 20_000 })
    .toBeTruthy();
}

const KEY: Record<Dir, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

/** Shortest path of directions from one tile to another on the town map. */
function path(from: { x: number; y: number }, to: { x: number; y: number }): Dir[] {
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const prev = new Map<string, { from: string; dir: Dir }>();
  const queue = [from];
  const seen = new Set([key(from)]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.x === to.x && cur.y === to.y) break;
    for (const d of DIRECTIONS) {
      const n = tryStep(townMap, cur.x, cur.y, d);
      if (n && !seen.has(key(n))) {
        seen.add(key(n));
        prev.set(key(n), { from: key(cur), dir: d });
        queue.push(n);
      }
    }
  }
  const dirs: Dir[] = [];
  for (let k = key(to); k !== key(from);) {
    const p = prev.get(k);
    if (!p) throw new Error(`No path to ${key(to)}`);
    dirs.unshift(p.dir);
    k = p.from;
  }
  return dirs;
}

/** Walks the local player to a tile using the arrow keys, one step at a time. */
export async function walkTo(page: Page, target: { x: number; y: number }) {
  for (let guard = 0; guard < 80; guard++) {
    const s = (await snapshot(page)).self!;
    if (s.x === target.x && s.y === target.y) return settle(page);
    const dir = path(s, target)[0]!;
    await page.keyboard.down(KEY[dir]);
    await expect
      .poll(async () => {
        const now = (await snapshot(page)).self!;
        return now.x !== s.x || now.y !== s.y;
      })
      .toBe(true);
    await page.keyboard.up(KEY[dir]);
  }
  throw new Error("walkTo gave up");
}

/** Faces a direction without moving (a quick tap), or bumps into a wall. */
export async function tap(page: Page, dir: Dir) {
  await page.keyboard.down(KEY[dir]);
  await page.waitForTimeout(40);
  await page.keyboard.up(KEY[dir]);
  await expect.poll(async () => (await snapshot(page)).self!.dir).toBe(dir);
}

/** Waits until the local player has stopped moving. */
export async function settle(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const s = (await snapshot(page)).self!;
      const now = JSON.stringify(s.px);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}
