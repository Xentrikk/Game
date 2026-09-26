import { STEP_MS_RUN, STEP_MS_WALK, type Dir } from "./constants";
import { tryStep, type WorldMap } from "./map";

/**
 * Speed check for steps. A token bucket measured in milliseconds: it refills in real time, and each step
 * spends its duration. The small capacity absorbs network jitter (several step messages arriving at once)
 * without letting anyone move faster than running speed over time.
 */
export const BUCKET_CAPACITY_MS = 3 * STEP_MS_WALK;
/** Allow steps that arrive up to 10% early, for clock and network jitter. */
const EARLY_TOLERANCE = 0.9;

export interface Mover {
  x: number;
  y: number;
  budgetMs: number;
  lastRefill: number;
}

export function newMover(x: number, y: number, now: number): Mover {
  return { x, y, budgetMs: BUCKET_CAPACITY_MS, lastRefill: now };
}

export type StepResult = { ok: true; x: number; y: number } | { ok: false; reason: "blocked" | "too_fast" };

export function applyStep(map: WorldMap, m: Mover, dir: Dir, run: boolean, now: number): StepResult {
  m.budgetMs = Math.min(BUCKET_CAPACITY_MS, m.budgetMs + (now - m.lastRefill));
  m.lastRefill = now;
  const cost = run ? STEP_MS_RUN : STEP_MS_WALK;
  if (m.budgetMs < cost * EARLY_TOLERANCE) return { ok: false, reason: "too_fast" };
  const next = tryStep(map, m.x, m.y, dir);
  if (!next) return { ok: false, reason: "blocked" };
  m.budgetMs -= cost;
  m.x = next.x;
  m.y = next.y;
  return { ok: true, ...next };
}
