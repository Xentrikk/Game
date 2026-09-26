import { DIR_VECTORS, type Dir } from "./constants";

/** The subset of the Tiled JSON map format (https://doc.mapeditor.org/en/stable/reference/json-map-format/) we use. */
export interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}
export interface TiledObject {
  id: number;
  name: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
}
export interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup";
  width?: number;
  height?: number;
  data?: number[];
  objects?: TiledObject[];
}
export interface TiledTileset {
  firstgid: number;
  name: string;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  image: string;
  tiles?: { id: number; properties?: TiledProperty[] }[];
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

export interface Sign {
  x: number;
  y: number;
  pages: string[];
}
export interface Npc {
  id: string;
  name: string;
  x: number;
  y: number;
  dir: Dir;
  /** Seed for a generated appearance, so NPCs look the same everywhere. */
  seed: number;
  pages: string[];
}

export interface WorldMap {
  width: number;
  height: number;
  /** 1 = blocked. Index: y * width + x. */
  blocked: Uint8Array;
  spawns: { x: number; y: number }[];
  signs: Sign[];
  npcs: Npc[];
}

function prop<T>(o: { properties?: TiledProperty[] }, name: string): T | undefined {
  return o.properties?.find((p) => p.name === name)?.value as T | undefined;
}

/** Tiled text properties use "\n\n" (a blank line) to separate dialogue pages. */
function pages(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Tile layers whose tiles can block movement. The overhead layer never blocks. */
const COLLISION_LAYERS = ["ground", "decor"];

export function parseMap(map: TiledMap): WorldMap {
  const { width, height } = map;
  const blocked = new Uint8Array(width * height);

  const collidingGids = new Set<number>();
  for (const ts of map.tilesets) {
    for (const tile of ts.tiles ?? []) {
      if (prop<boolean>(tile, "collides")) collidingGids.add(ts.firstgid + tile.id);
    }
  }
  for (const layer of map.layers) {
    if (layer.type !== "tilelayer" || !COLLISION_LAYERS.includes(layer.name) || !layer.data) continue;
    layer.data.forEach((gid, i) => {
      if (collidingGids.has(gid)) blocked[i] = 1;
    });
  }

  const spawns: WorldMap["spawns"] = [];
  const signs: Sign[] = [];
  const npcs: Npc[] = [];
  const objects = map.layers.filter((l) => l.type === "objectgroup").flatMap((l) => l.objects ?? []);
  for (const o of objects) {
    const kind = o.type ?? o.class;
    const x = Math.floor(o.x / map.tilewidth);
    const y = Math.floor(o.y / map.tileheight);
    if (kind === "spawn") spawns.push({ x, y });
    if (kind === "sign") signs.push({ x, y, pages: pages(prop<string>(o, "text")) });
    if (kind === "npc") {
      npcs.push({
        id: `npc-${o.id}`,
        name: o.name,
        x,
        y,
        dir: (prop<string>(o, "dir") as Dir) ?? "down",
        seed: prop<number>(o, "seed") ?? o.id,
        pages: pages(prop<string>(o, "text")),
      });
      blocked[y * width + x] = 1;
    }
  }
  if (!spawns.length) throw new Error("Map has no spawn points");
  return { width, height, blocked, spawns, signs, npcs };
}

export function isBlocked(map: WorldMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.blocked[y * map.width + x] === 1;
}

/** Where a step from (x, y) in `dir` lands, or null if that tile is blocked. */
export function tryStep(map: WorldMap, x: number, y: number, dir: Dir): { x: number; y: number } | null {
  const [dx, dy] = DIR_VECTORS[dir];
  const nx = x + dx;
  const ny = y + dy;
  return isBlocked(map, nx, ny) ? null : { x: nx, y: ny };
}

/** The sign or NPC on the tile in front of (x, y), if any. */
export function interactionAt(map: WorldMap, x: number, y: number, dir: Dir): Sign | Npc | undefined {
  const [dx, dy] = DIR_VECTORS[dir];
  const tx = x + dx;
  const ty = y + dy;
  return map.npcs.find((n) => n.x === tx && n.y === ty) ?? map.signs.find((s) => s.x === tx && s.y === ty);
}
