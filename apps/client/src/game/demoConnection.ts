import {
  DIRECTIONS,
  applyStep,
  dirIndex,
  newMover,
  parseMap,
  randomAppearance,
  tryStep,
  type Appearance,
  type Mover,
  type TiledMap,
} from "@hearth/shared";
import town from "@hearth/shared/maps/town.json";
import type { NetPlayer, PlayerHandlers, WorldConnection } from "./connection";

/** Simulated network delay for the offline demo, so it feels like the real thing. */
const LATENCY_MS = 40;
const SELF = "you";
const VILLAGERS = ["Juniper", "Theo", "Marisol", "Kenji", "Ada", "Rook", "Wren"];
/** Villagers stroll around the plaza and the paths around it. */
const AREA = { x0: 12, y0: 9, x1: 27, y1: 20 };

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An offline stand-in for the Town Square server: your moves go through the same rules the server
 * uses (collision and the speed check), and a few villagers wander around so the town feels alive.
 */
export function demoConnection(me: {
  handle: string;
  name: string;
  appearance: Appearance;
}): WorldConnection {
  const map = parseMap(town as TiledMap);
  const players = new Map<string, NetPlayer>();
  const movers = new Map<string, Mover>();
  const handlers: PlayerHandlers[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const emit = (id: string) => handlers.forEach((h) => h.onChange(id, players.get(id)!));

  const add = (id: string, p: NetPlayer) => {
    players.set(id, p);
    movers.set(id, newMover(p.x, p.y, performance.now()));
    handlers.forEach((h) => h.onAdd(id, p));
  };

  const spawn = map.spawns[0]!;
  add(SELF, {
    handle: me.handle,
    name: me.name,
    appearance: JSON.stringify(me.appearance),
    x: spawn.x,
    y: spawn.y,
    dir: dirIndex("down"),
    run: false,
    seq: 0,
    connected: true,
  });

  const rand = seeded(2026);
  VILLAGERS.forEach((name, i) => {
    let x = 0;
    let y = 0;
    do {
      x = AREA.x0 + Math.floor(rand() * (AREA.x1 - AREA.x0 + 1));
      y = AREA.y0 + Math.floor(rand() * (AREA.y1 - AREA.y0 + 1));
    } while (map.blocked[y * map.width + x] || [...players.values()].some((p) => p.x === x && p.y === y));
    const id = `villager-${i}`;
    add(id, {
      handle: name.toLowerCase(),
      name,
      appearance: JSON.stringify(randomAppearance(seeded(100 + i * 7919))),
      x,
      y,
      dir: dirIndex(DIRECTIONS[i % 4]!),
      run: false,
      seq: 0,
      connected: true,
    });
    // Each villager takes a step now and then, pausing in between like people do.
    let pause = Math.floor(rand() * 6);
    timers.push(
      setInterval(() => {
        if (pause-- > 0) return;
        if (rand() < 0.25) pause = 2 + Math.floor(rand() * 8);
        const p = players.get(id)!;
        const options = DIRECTIONS.filter((d) => {
          const n = tryStep(map, p.x, p.y, d);
          return n && n.x >= AREA.x0 && n.x <= AREA.x1 && n.y >= AREA.y0 && n.y <= AREA.y1;
        });
        const dir = options[Math.floor(rand() * options.length)];
        if (!dir) return;
        const result = applyStep(map, movers.get(id)!, dir, false, performance.now());
        p.dir = dirIndex(dir);
        if (result.ok) {
          p.x = result.x;
          p.y = result.y;
        }
        emit(id);
      }, 300),
    );
  });

  return {
    sessionId: SELF,
    subscribe(h) {
      handlers.push(h);
      for (const [id, p] of players) h.onAdd(id, p);
    },
    players: () => [...players.entries()],
    send(type: string, msg: { dir: (typeof DIRECTIONS)[number]; run?: boolean; seq?: number }) {
      setTimeout(() => {
        const p = players.get(SELF)!;
        if (type === "face") {
          p.dir = dirIndex(msg.dir);
        } else if (type === "move" && msg.seq && msg.seq > p.seq) {
          const result = applyStep(map, movers.get(SELF)!, msg.dir, !!msg.run, performance.now());
          p.seq = msg.seq;
          p.dir = dirIndex(msg.dir);
          if (result.ok) {
            p.x = result.x;
            p.y = result.y;
            p.run = !!msg.run;
          }
        }
        emit(SELF);
      }, LATENCY_MS);
    },
    onDrop: () => undefined,
    onReconnect: () => undefined,
    onLeave: () => undefined,
    leave: async () => timers.forEach((t) => clearInterval(t)),
    simulateDrop: () => undefined,
  };
}
