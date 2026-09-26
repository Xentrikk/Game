# Hearth

A cozy top-down pixel world where your friends live: a Game Boy–era–style alternative to texting and social media. The full product spec is in [`PROMPT.md`](PROMPT.md). The build goes phase by phase (Section 13 of the spec).

**Status:** Phase 1 (accounts and characters) and Phase 2 (the world) are done. See [`docs/phase-1.md`](docs/phase-1.md) and [`docs/phase-2.md`](docs/phase-2.md).

## What's here

| Path              | What it is                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/client`     | Web client (React + Vite), mobile-first. Sign-in, onboarding, character creator, sprite compositor.                                             |
| `apps/server`     | API server (Node + Express). OTP sign-in with rate limits, age gate, onboarding, character saves. The Colyseus game server joins it in Phase 2. |
| `apps/mobile`     | Capacitor wrapper that ships `apps/client` as the iOS and Android apps.                                                                         |
| `packages/shared` | Types, zod schemas, the appearance catalog, and handle/age/profanity rules shared by client and server.                                         |
| `supabase/`       | Database migrations (with rollbacks in `supabase/rollbacks`), RLS policies, auth config and email templates.                                    |
| `docs/`           | Phase plans, decisions log, art pipeline.                                                                                                       |

## Run it locally

Requirements: Node 20+, pnpm 10, Docker (for the local Supabase stack).

```sh
pnpm install
cp .env.example .env
pnpm db:start     # local Supabase: Postgres, Auth, and Mailpit for emails at http://127.0.0.1:54324
pnpm dev          # API on :2567 and the client on http://localhost:5173
```

Local sign-in doesn't send real texts or emails:

- **Phone:** use a test number from `supabase/config.toml` (`[auth.sms.test_otp]`), e.g. US `555 555 0100`. The code is always `123456`.
- **Email:** any address works. Read the code or link in Mailpit at http://127.0.0.1:54324.

## Playing

Sign in, then choose **Enter the Town Square**. Open it in a second browser (or a private window) with another account to see each other.

|                                | Keyboard                                  | Touch       |
| ------------------------------ | ----------------------------------------- | ----------- |
| Walk                           | Arrows / WASD (tap to turn, hold to walk) | D-pad       |
| Talk / read                    | Z, Enter or Space                         | A           |
| Run                            | Hold Shift, or X to toggle                | B toggles   |
| Menu (Pocket mode, leave town) | Esc                                       | Menu button |

In development, add `?hour=22` to the URL to preview the night tint.

## Offline preview

`pnpm --filter @hearth/client build:demo` builds a single self-contained HTML file (`apps/client/dist-demo/demo.html`) that needs no server. You make a character and walk the Town Square with a few bot villagers, using the same movement rules as the real server. It's for sharing a quick look at the game. Sign-up, friends and chat need the real server.

## Tests

```sh
pnpm test         # unit tests (shared rules, API with fakes, sprite compositor)
pnpm test:db      # integration tests against the local Supabase stack (RLS, triggers, real OTP)
pnpm test:e2e     # Playwright end-to-end on phone and desktop viewports (starts its own servers)
pnpm lint && pnpm typecheck && pnpm format:check
```

Load test (needs `pnpm dev` running): `pnpm loadtest` runs 50 bot players for 30 s. Use `BOTS=500 SECONDS=60 pnpm loadtest` for the 500-connection budget. It prints acknowledgment latency and PASS/FAIL.

To use a preinstalled Chromium for Playwright, set `PW_CHROMIUM_PATH=/path/to/chrome`. Otherwise run `pnpm --filter @hearth/client exec playwright install chromium`. Set `SCREENSHOT_DIR=/some/dir` to save a screenshot of every onboarding screen during the e2e run.

CI (`.github/workflows/ci.yml`) runs all of these, plus a dependency audit and a check that the sprite sheets are up to date.

## Environment variables

All are listed with comments in [`.env.example`](.env.example). Only `VITE_*` values reach the browser, and those are public. The service role key, captcha secret and Twilio token are server-only. Never commit a real `.env`.

## Mobile apps

```sh
pnpm --filter @hearth/mobile add:android   # once; needs Android Studio / SDK
pnpm --filter @hearth/mobile add:ios       # once; needs macOS + Xcode
VITE_API_URL=https://your-api.example.com pnpm --filter @hearth/mobile android   # or: ios
```

The native projects aren't committed yet (see `docs/decisions.md`).

## Art

Character sprites (`apps/client/public/sprites`, `pnpm sprites`) and the Town Square tileset and map (`apps/client/public/tiles/town.png`, `packages/shared/maps/town.json`, `pnpm --filter @hearth/client town`) are **generated placeholders**. Real art can replace them file for file, and the map opens in [Tiled](https://www.mapeditor.org/). See [`docs/art-pipeline.md`](docs/art-pipeline.md). `pnpm --filter @hearth/client exec tsx scripts/preview-town.ts` renders the whole map to a PNG.
