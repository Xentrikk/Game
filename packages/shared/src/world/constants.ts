/** World constants shared by client and server. See PROMPT.md Sections 3 and 6. */

export const TILE = 16;
export const VIEW_W = 320;
export const VIEW_H = 180;

/** Milliseconds to walk one tile. Running halves it (doubles speed). */
export const STEP_MS_WALK = 250;
export const STEP_MS_RUN = 125;

export const TOWN_ROOM = "town";
export const TOWN_MAX_PLAYERS = 50;
/** Seconds a dropped player keeps their spot while reconnecting. */
export const RECONNECT_SECONDS = 30;
/** Server patch interval (20 Hz). */
export const PATCH_MS = 50;

export const DIRECTIONS = ["down", "left", "right", "up"] as const;
export type Dir = (typeof DIRECTIONS)[number];

export const DIR_VECTORS: Record<Dir, readonly [number, number]> = {
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
};

export function dirIndex(dir: Dir): number {
  return DIRECTIONS.indexOf(dir);
}

export function dirFromIndex(i: number): Dir {
  return DIRECTIONS[i] ?? "down";
}

export function stepMs(run: boolean): number {
  return run ? STEP_MS_RUN : STEP_MS_WALK;
}
