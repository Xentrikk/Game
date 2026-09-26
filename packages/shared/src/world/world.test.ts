import { describe, expect, it } from "vitest";
import town from "../../maps/town.json";
import { DIRECTIONS, DIR_VECTORS, interactionAt, isBlocked, parseMap, tryStep, type TiledMap } from "./index";

const map = parseMap(town as TiledMap);

/** Every tile reachable on foot from the first spawn point. */
function reachable(): Set<string> {
  const start = map.spawns[0]!;
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  while (queue.length) {
    const { x, y } = queue.shift()!;
    for (const d of DIRECTIONS) {
      const next = tryStep(map, x, y, d);
      if (next && !seen.has(`${next.x},${next.y}`)) {
        seen.add(`${next.x},${next.y}`);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe("town map", () => {
  it("is 40×30 with spawns, signs and NPCs", () => {
    expect([map.width, map.height]).toEqual([40, 30]);
    expect(map.spawns.length).toBeGreaterThanOrEqual(4);
    expect(map.signs.length).toBeGreaterThan(5);
    expect(map.npcs.map((n) => n.name)).toEqual(["Mayor Pip", "Fern", "Robin"]);
  });

  it("puts spawn points on open ground", () => {
    for (const s of map.spawns) expect(isBlocked(map, s.x, s.y), `${s.x},${s.y}`).toBe(false);
  });

  it("blocks the map edges, water, buildings, the fountain and NPCs", () => {
    expect(isBlocked(map, -1, 5)).toBe(true);
    expect(isBlocked(map, 40, 5)).toBe(true);
    expect(isBlocked(map, 0, 0)).toBe(true); // border trees are solid, canopy included
    expect(isBlocked(map, 12, 2)).toBe(false); // other trees: walk behind the canopy…
    expect(isBlocked(map, 12, 3)).toBe(true); // …but not through the trunk
    expect(isBlocked(map, 6, 22)).toBe(true); // pond
    expect(isBlocked(map, 7, 5)).toBe(true); // café roof
    expect(isBlocked(map, 19, 13)).toBe(true); // fountain
    for (const n of map.npcs) expect(isBlocked(map, n.x, n.y)).toBe(true);
  });

  it("lets players walk everywhere important, but not out of town", () => {
    const seen = reachable();
    for (const s of map.spawns) expect(seen.has(`${s.x},${s.y}`)).toBe(true);
    // Every sign and NPC can be walked up to and faced.
    for (const target of [...map.signs, ...map.npcs]) {
      const standable = DIRECTIONS.some((d) => {
        const [dx, dy] = DIR_VECTORS[d];
        const sx = target.x - dx;
        const sy = target.y - dy;
        return seen.has(`${sx},${sy}`) && interactionAt(map, sx, sy, d) === target;
      });
      expect(standable, JSON.stringify(target).slice(0, 80)).toBe(true);
    }
    // Nobody can reach the outer edge of the map (e.g. around the fence on the road to the Wilds).
    for (const key of seen) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      expect(x > 0 && y > 0 && x < map.width - 1 && y < map.height - 1, key).toBe(true);
    }
  });

  it("has text on every sign and NPC", () => {
    for (const s of [...map.signs, ...map.npcs]) expect(s.pages.length).toBeGreaterThan(0);
  });
});

describe("movement rules", () => {
  it("steps one tile in each direction and refuses blocked tiles", () => {
    const s = map.spawns[0]!;
    expect(tryStep(map, s.x, s.y, "right")).toEqual({ x: s.x + 1, y: s.y });
    expect(tryStep(map, 19, 15, "up")).toBeNull(); // into the fountain
  });
});
