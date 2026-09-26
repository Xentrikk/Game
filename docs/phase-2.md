# Phase 2: The world

Spec: PROMPT.md Section 13, Phase 2.

> **Done when:** two browsers see each other walk around smoothly. A reconnect after a network drop restores position. The 50-player load test passes the frame budget.

## Plan

### Shared (`packages/shared/src/world/`)

- **Constants:** 16px tiles, 320×180 view, 250ms walk step / 125ms run step, 50 players per Town Square instance, 30s reconnect window.
- **Map model:** parse the Tiled JSON map once into a collision grid, spawn points, signs and NPCs. Client and server use the same code, so they agree on what's walkable.
- **Movement rules:** `canStep()` and direction vectors. Movement is grid-only, with no diagonals.
- **Network state** (Colyseus schema): players with handle, name, appearance, tile x/y, facing, speed, and last processed move `seq`.
- **Message schemas** (zod): `move {dir, run, seq}` and `face {dir}`.

### Map and tiles

- A generated placeholder tileset: 16×16 tiles, at most 32 colors (tested).
- The Town Square map (40×30) in Tiled JSON with `ground`, `decor` and `overhead` layers. Collision is a tile property. An object layer holds spawn points, signs and NPCs.
- Areas: the plaza with a fountain and notice board, a café, a post office, a trading post, a park with a pond, the home portal, and the closed road to the Wilds. Buildings and the portal show "opening soon" signs until later phases.

### Server (`apps/server`)

- Colyseus runs on the same HTTP server as the API.
- `town` room with `maxClients = 50`. When an instance is full, matchmaking opens a new one (a shard).
- `onAuth` verifies the Supabase token and loads the profile and appearance. A player without a character is refused.
- One presence per account: joining again replaces the older session.
- Server-authoritative movement. Each step is checked against the collision grid and a speed token bucket (it absorbs network bunching but not speed hacks). Rejected steps are still acknowledged, so the client snaps back.
- A dropped client keeps its spot for 30s (`allowReconnection`).
- The patch rate is 20 Hz, and message rates are capped.

### Client (`apps/client`)

- A Phaser 3 world scene at 320×180, always scaled by a whole number of _device_ pixels, letterboxed, with the camera snapped to pixels.
- The local player moves immediately (prediction) and replays unacknowledged steps when the server's state arrives (reconciliation).
- Other players glide between tiles, with walk animations.
- Tap a direction to turn in place; hold it to walk. A run toggle doubles speed.
- Name tags use a tiny built-in pixel font.
- Signs and NPCs open the existing dialogue box with the A button.
- Day/night tint follows the player's local time. An optional "Pocket mode" post-process shader turns everything into four Game Boy greens.
- Touch controls (D-pad, A, B/run) sit below the screen on phones, like a Game Boy. Keyboard: arrows/WASD, Z/Enter/Space, X/Shift.
- A connection banner shows "Reconnecting…" while the SDK reconnects on its own.

### Tests

- **Unit:** map parsing and collision, movement rules, tileset color count.
- **Server room tests** (a real Colyseus server with a fake auth): join and spawn, legal and illegal steps, speed-hack rejection, collision, one presence per account, reconnection keeping position, the 51st player going to a new instance.
- **E2E:** two browsers see each other move; walking into the fountain is blocked; a sign opens a dialogue; a dropped connection reconnects in place.
- **Load:** `pnpm loadtest` runs N bot players walking around (reports server acknowledgment latency). A Playwright perf test puts a browser among 49 bots with CPU throttling and records its frame rate.

## Status: done

All three "done when" criteria are met and covered by automated tests.

| Criterion                                          | Evidence                                                                                                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two browsers see each other walk around smoothly   | e2e `two players see each other walk around smoothly`: B sees A arrive on the exact tile, and while A takes one step, B's view of A passes through at least 3 in-between pixel positions.                                     |
| A reconnect after a network drop restores position | e2e `a dropped connection reconnects in the same place` (socket killed mid-session, "Reconnecting…" shown, same tile, still one A for other players, walking resumes). Also the room test `keeps a dropped player in place…`. |
| The 50-player load test passes the frame budget    | e2e `perf.spec.ts` on a phone viewport with CPU throttled 4× (DevTools "mid-tier mobile"), 49 bots walking the plaza: **60.0 fps average, 0 dropped frames out of 601, 48 other players on screen.**                          |

**Server load** (`pnpm loadtest`, bots and server on the same 4-core machine):

| Bots | Instances | Steps/s | Ack latency p50 / p95 / p99 / max | Errors |
| ---- | --------- | ------- | --------------------------------- | ------ |
| 50   | 1         | 184     | 26 / 49 / 51 / 55 ms              | 0      |
| 500  | 10        | 1,884   | 27 / 50 / 53 / 101 ms             | 0      |

p95 ≈ 50 ms is the 20 Hz patch interval itself. The server isn't the bottleneck. This meets the "≥ 500 concurrent connections per server instance" budget in PROMPT.md Section 12.

**Other tests added:** 7 map/movement unit tests (every sign and NPC can be walked up to; nobody can reach the map edge), 11 Town Square room tests (auth at matchmaking, spawn, legal/illegal/too-fast/replayed steps, unknown messages disconnect, reconnection, one presence per account, the 51st player opening a new instance), 3 tiny-font tests, and pixel-level checks that night is darker than day and that Pocket mode draws only the four Game Boy greens.

**Bugs the tests caught along the way:**

- Players could reach the map edge by walking behind border tree canopies.
- Matchmaking reserved seats for requests without a token.
- The server never initialized the move counter, so real clients' steps were rejected; room tests had missed it because they sent explicit numbers.
- The day/night overlay never actually rendered.
- The game canvas was centered on half pixels, which blurs pixel art.

**Known limitations:**

- Real phones haven't been tested yet (Phase 6). The frame-rate numbers come from a throttled desktop Chromium.
- With 50 strangers on one plaza, name tags overlap. Phase 3 can show friends' tags first or fade distant ones.
