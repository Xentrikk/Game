/**
 * Bot players for load and performance tests. Bots are real accounts (bot-N@load.hearth.test) that
 * sign in, join the Town Square and wander around the plaza at walking speed, like people would.
 */
import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  DIRECTIONS,
  PRIVACY_VERSION,
  STEP_MS_WALK,
  TOS_VERSION,
  TOWN_ROOM,
  TownState,
  parseMap,
  randomAppearance,
  tryStep,
  type PlayerState,
  type TiledMap,
} from "@hearth/shared";
import town from "@hearth/shared/maps/town.json" with { type: "json" };
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PASSWORD = "hearth-bot-password";
const map = parseMap(town as TiledMap);
/** Bots stay on the plaza, so they're on screen for a player standing there. */
const PLAZA = { x0: 14, y0: 10, x1: 25, y1: 19 };

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/** Signs in (creating and onboarding the account the first time) and returns an access token per bot. */
export async function botTokens(count: number, apiUrl: string): Promise<string[]> {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  return pool(
    Array.from({ length: count }, (_, i) => i),
    10,
    async (i) => {
      const email = `bot-${i}@load.hearth.test`;
      const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      let res = await anon.auth.signInWithPassword({ email, password: PASSWORD });
      if (res.error) {
        await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
        res = await anon.auth.signInWithPassword({ email, password: PASSWORD });
        if (res.error) throw res.error;
      }
      const token = res.data.session!.access_token;
      const call = (method: string, path: string, body?: unknown) =>
        fetch(`${apiUrl}${path}`, {
          method,
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      const me = (await (await call("GET", "/api/me")).json()) as {
        onboarding: { hasCharacter: boolean; handle: string | null };
      };
      if (!me.onboarding.hasCharacter) {
        await call("POST", "/api/onboarding/age", { dob: "1999-09-09" });
        await call("POST", "/api/onboarding/terms", {
          tosVersion: TOS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        });
        if (!me.onboarding.handle) await call("POST", "/api/onboarding/handle", { handle: `bot_${i}` });
        const r = await call("PUT", "/api/character", {
          displayName: `Bot ${i}`,
          pronouns: "",
          bio: "",
          appearance: randomAppearance(),
        });
        if (!r.ok) throw new Error(`Bot ${i} onboarding failed: ${await r.text()}`);
      }
      return token;
    },
  );
}

export interface BotStats {
  sent: number;
  acked: number;
  moved: number;
  /** Milliseconds from sending a step to the server acknowledging it. */
  ackLatencies: number[];
  errors: string[];
}

export interface BotSwarm {
  rooms: Room<unknown, TownState>[];
  stats: BotStats;
  stop(): Promise<void>;
}

/** Connects bots to the Town Square and starts them wandering the plaza. */
export async function startBots(tokens: string[], gameUrl: string): Promise<BotSwarm> {
  const stats: BotStats = { sent: 0, acked: 0, moved: 0, ackLatencies: [], errors: [] };
  const timers: ReturnType<typeof setInterval>[] = [];
  const rooms = await pool(tokens, 20, async (token) => {
    const client = new Client(gameUrl);
    client.auth.token = token;
    const room = (await client.joinOrCreate(TOWN_ROOM, {}, TownState)) as Room<unknown, TownState>;
    room.onError((code, message) => stats.errors.push(`${code} ${message ?? ""}`));
    const sentAt = new Map<number, number>();
    let seq = 0;
    let last = { x: -1, y: -1 };
    const $ = getStateCallbacks(room);
    $(room.state).players.onAdd((p: PlayerState, id: string) => {
      if (id !== room.sessionId) return;
      $(p).onChange(() => {
        const t = sentAt.get(p.seq);
        if (t !== undefined) {
          stats.acked++;
          stats.ackLatencies.push(performance.now() - t);
          sentAt.delete(p.seq);
        }
        if (p.x !== last.x || p.y !== last.y) stats.moved++;
        last = { x: p.x, y: p.y };
      });
    });
    // Wander: each tick, try a random direction that stays on the plaza.
    const jitter = Math.random() * STEP_MS_WALK;
    timers.push(
      setTimeout(() => {
        timers.push(
          setInterval(() => {
            const me = room.state.players.get(room.sessionId);
            if (!me) return;
            const options = DIRECTIONS.filter((d) => {
              const n = tryStep(map, me.x, me.y, d);
              return n && n.x >= PLAZA.x0 && n.x <= PLAZA.x1 && n.y >= PLAZA.y0 && n.y <= PLAZA.y1;
            });
            const dir = options[Math.floor(Math.random() * options.length)] ?? "down";
            seq++;
            sentAt.set(seq, performance.now());
            stats.sent++;
            room.send("move", { dir, run: false, seq });
          }, STEP_MS_WALK + 20),
        );
      }, jitter) as unknown as ReturnType<typeof setInterval>,
    );
    return room;
  });
  return {
    rooms,
    stats,
    async stop() {
      for (const t of timers) clearInterval(t);
      await Promise.all(rooms.map((r) => r.leave().catch(() => undefined)));
    },
  };
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}
