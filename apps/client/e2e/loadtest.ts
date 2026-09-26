/**
 * Server load test: N bot players wander the Town Square; reports how fast the server acknowledges steps.
 *
 *   pnpm loadtest            # 50 bots for 30 s against http://localhost:2567
 *   BOTS=500 SECONDS=60 pnpm loadtest
 *
 * Needs the local stack running (pnpm db:start && pnpm dev).
 */
import { botTokens, percentile, startBots } from "./bots";

const BOTS = Number(process.env.BOTS ?? 50);
const SECONDS = Number(process.env.SECONDS ?? 30);
const API = process.env.API_URL ?? "http://localhost:2567";
const GAME = process.env.GAME_URL ?? API;

console.log(`Signing in ${BOTS} bots…`);
const t0 = performance.now();
const tokens = await botTokens(BOTS, API);
console.log(`  ready in ${((performance.now() - t0) / 1000).toFixed(1)} s. Connecting…`);
const swarm = await startBots(tokens, GAME);
const instances = new Set(swarm.rooms.map((r) => r.roomId)).size;
console.log(
  `  ${swarm.rooms.length} connected across ${instances} Town Square instance(s). Walking for ${SECONDS} s…`,
);
await new Promise((r) => setTimeout(r, SECONDS * 1000));
await swarm.stop();

const { stats } = swarm;
const lat = stats.ackLatencies;
const report = {
  bots: BOTS,
  instances,
  seconds: SECONDS,
  stepsSent: stats.sent,
  stepsAcknowledged: stats.acked,
  stepsPerSecond: Math.round(stats.acked / SECONDS),
  ackLatencyMs: {
    p50: Math.round(percentile(lat, 50)),
    p95: Math.round(percentile(lat, 95)),
    p99: Math.round(percentile(lat, 99)),
    max: Math.round(Math.max(...lat)),
  },
  errors: stats.errors.length,
};
console.log(JSON.stringify(report, null, 2));
const lost = stats.sent - stats.acked;
// Budget: every step acknowledged (allowing the last in-flight step per bot) and p95 within two patch intervals + slack.
const ok = lost <= BOTS && report.ackLatencyMs.p95 <= 150 && stats.errors.length === 0;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
