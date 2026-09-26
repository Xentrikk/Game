# Build Prompt: "Hearth" — A Top-Down Pixel Social World

> **How to use this file:** This is the master prompt to hand to a coding agent (e.g. Claude Code) to build the game. Before you run it, go through **Section 0 — Decisions to confirm** and change anything you disagree with. Everything after Section 0 is written as instructions to the agent.
>
> "Hearth" is a placeholder name. Swap it everywhere once you pick a real one.

---

## 0. Decisions to confirm before executing

These are the choices that most change the build. The prompt already uses the **bold** default; change the value and the rest of the prompt still holds.

| # | Decision | Default in this prompt | Alternatives |
|---|---|---|---|
| 1 | Target platforms | **Web (mobile-first PWA) + iOS/Android via Capacitor from the same code** | Native mobile only; desktop only |
| 2 | Minimum age | **13+ (blocks under-13 at signup to avoid COPPA scope)** | 16+ (simplifies EU GDPR consent); 18+ |
| 3 | Backend | **Supabase (Auth + Postgres + Storage) and a separate Node game server (Colyseus)** | Firebase; fully self-hosted Postgres + custom auth |
| 4 | SMS provider for phone sign-in | **Twilio Verify via Supabase Auth** | MessageBird, Vonage |
| 5 | Message encryption | **TLS in transit + encrypted at rest; server can read for moderation. End-to-end encryption deferred to a later phase** | E2E for DMs from day one (makes abuse reporting harder) |
| 6 | Real-money purchases | **None in v1. In-game currency is earned only** | Cosmetic shop with real money in a later phase (no loot boxes, ever) |
| 7 | Art source | **Original pixel art; CC0 placeholders (e.g. Kenney.nl) until final art exists** | Commissioned artist; AI-generated then hand-cleaned |
| 8 | Voice chat | **Not in v1** | Proximity voice in a later phase |

**Never use Nintendo, Game Freak or Square Enix names, sprites, music, maps, fonts or characters.** We want the *feel* of Game Boy–era Pokémon and early Final Fantasy, not their assets.

---

## 1. Role and goal

You are a senior full-stack game engineer. Build **Hearth**: a top-down (bird's-eye) 2D pixel-art online world, in the style of Game Boy Color–era Pokémon and SNES-era Final Fantasy overworlds, that people use **instead of texting and social media** to hang out with friends.

The core promise: *Your friends live here. You walk over to them, talk, give them things, and leave them notes. It feels cozy, not addictive.*

It is **not** a combat RPG. There is no grinding, no PvP, no infinite feed and no follower counts. Everything is built around real friends.

Work in phases (Section 12). At the end of each phase the app must build, pass its tests and be playable. Do not start a phase until the previous one meets its acceptance criteria.

---

## 2. Tech stack (use exactly this unless Section 0 says otherwise)

- **Language:** TypeScript everywhere, `strict: true`.
- **Monorepo:** pnpm workspaces.
  - `apps/client`: Phaser 3 game plus React for menus and overlays (chat, inventory, settings), built with Vite.
  - `apps/server`: Node 20+ with Colyseus for real-time rooms. It is the authoritative game state server.
  - `apps/mobile`: Capacitor wrapper around `apps/client` for iOS and Android.
  - `packages/shared`: shared types, message schemas (zod), constants, item definitions.
  - `supabase/`: SQL migrations, Row Level Security (RLS) policies, edge functions.
- **Auth:** Supabase Auth with phone OTP (SMS) and email (magic link plus an optional password).
- **Database:** Postgres (Supabase). Every table has RLS enabled.
- **Cache and presence:** Redis, for presence, rate limits and the Colyseus presence driver.
- **Maps:** Tiled (`.tmj` JSON) with 16×16 tiles.
- **Testing:** Vitest (unit), Playwright (end-to-end, including two browser contexts talking to each other), and a load-test script for the server.
- **Tooling:** ESLint, Prettier, Husky pre-commit, GitHub Actions CI (lint, typecheck, test, build).
- **Local dev:** one `docker compose up` (or `pnpm dev`) brings up Postgres/Supabase local, Redis, the server and the client.

---

## 3. Visual and audio style (be exact)

- **Tile size:** 16×16 px. **Character sprites:** 16×24 px (a head-and-shoulders overhang is allowed), 4 directions × 3 walk frames plus 1 idle.
- **Internal resolution:** 320×180, scaled up by integer factors only, with nearest-neighbor filtering and no sub-pixel rendering. Letterbox any leftover space. Snap the camera to whole pixels.
- **Palette:** each area uses a limited palette of at most 32 colors. Offer an optional **"Pocket mode"** setting that renders the whole game in a 4-shade green palette, like the original Game Boy, using a post-process shader.
- **Movement:** grid-based, tile by tile, like Pokémon. Holding a direction walks, and a run toggle doubles speed. The player turns in place when tapping a direction they are not facing. There is no diagonal movement.
- **UI:** a bordered dialogue box at the bottom with a typewriter text effect and a ▼ "next" indicator; a Final Fantasy–style menu window with a pointing-hand cursor. Use an open-licensed pixel font (e.g. "Press Start 2P" or "m5x7") and record its license in `CREDITS.md`.
- **Audio:** chiptune music loops per area and short SFX for steps, menu moves, message received and trade complete. Include a master volume and a mute toggle. Use only original or CC0 audio.
- **Day/night:** a palette tint that follows the player's **local** time.
- **Accessibility:** a colorblind-safe mode for UI colors, a text size option (1×/2× dialogue font), a reduce-motion option, full keyboard/controller support, and screen-reader labels on all React menus.

---

## 4. Accounts and sign-up

### 4.1 Flow
1. Welcome screen: **"Continue with phone"** or **"Continue with email."**
2. **Phone:** the user enters a number in E.164 format with a country picker, then a 6-digit OTP. The code expires after 10 minutes. Allow at most 5 attempts per code and 3 code sends per number per hour.
3. **Email:** the user gets a magic link, and can optionally set a password later.
4. **Age gate:** ask for date of birth. If the user is under the minimum age (Section 0), block sign-up with a neutral message. Do not store the DOB of blocked users.
5. Accept Terms of Service and Privacy Policy (links to placeholder pages in `/legal`).
6. Pick a **unique handle**: 3–16 characters, `a-z 0-9 _`, case-insensitive uniqueness, profanity- and reserved-word filtered.
7. → Character creation (Section 5).

### 4.2 Requirements
- A user can link **both** a phone and an email to one account, and sign in with either.
- Phone numbers and emails are **never** shown to other players.
- **Optional contact discovery:** if the user opts in, hash their contacts' phone numbers and emails on the device, match them on the server against users who also opted in, and show "People you may know". Never upload raw contacts, and never store the hashes after matching.
- Sessions use a refresh token. The user can see and sign out other devices.
- **Account deletion:** a self-serve "Delete my account" option that removes personal data within 30 days. Also provide a data export as a JSON download.
- Every auth endpoint is rate-limited. Include CAPTCHA (e.g. hCaptcha/Turnstile) on OTP send, to prevent SMS toll fraud.

---

## 5. Character creation

A full-screen creator with a live, rotating (4-direction) preview of the walking sprite.

- **Layers** (composited at runtime from separate sprite sheets): body/base → skin tone → eyes → hair (back) → outfit bottom → outfit top → shoes → hair (front) → accessory (hat/glasses).
- **Options at launch:** 3 body shapes, 10 skin tones, 12 hairstyles × 12 hair colors, 8 eye styles × 8 eye colors, 10 tops, 10 bottoms, 6 shoes and 8 accessories. Clothing colors use **palette swapping** (each garment has 2–3 swappable color slots from a 24-color set).
- **Identity fields:** display name (can differ from handle), pronouns (free text, optional, shown on profile), and a short bio of 80 characters.
- A **Randomize** button and an **Undo** button.
- Every appearance can be changed later at an in-world **Wardrobe** in the player's home, at no cost.
- Store the appearance as a compact JSON document, not as a rendered image, so the server can validate it against allowed option IDs.

---

## 6. The world

### 6.1 Structure
- **Town Square (public hub):** a small town with a plaza, café, post office, market/trading post, park with a pond, notice board and a portal to friends' homes. It is **instanced by shard**, with at most 50 players per instance. Friends are placed in the same instance when possible.
- **Homes (private):** every player gets a house interior plus a small yard. Only the owner, and the friends they allow in, can enter. This is where friends hang out privately. The owner sets it to "Open to friends", "Invite only" or "Closed".
- **Hangout rooms:** a player can create a temporary room (e.g. a campfire, a rooftop or a beach) and invite up to 12 friends. It ends when empty.

### 6.2 Moving and presence
- Other players move smoothly between tiles. The server is authoritative on position. The client predicts its own movement and reconciles when the server disagrees.
- Name tags appear above players. Friends' tags use a distinct color.
- **Presence states:** Online, Away (idle 5 min), Do Not Disturb, Appear Offline. The friends list shows where each friend is ("At home", "Town Square").
- **"Go to friend":** from the friends list, jump to a friend's current instance, if their privacy settings allow it.

---

## 7. Communication (the core of the product)

This is replacing text messaging, so it must be **reliable, fast and work when friends aren't online**.

### 7.1 Channels
- **Say (local):** speech bubbles over the character, visible to players within 6 tiles, which also go into a local chat log. Max 200 characters. The bubble shows for 5 seconds + 60 ms per character.
- **Direct messages (1:1):** persistent, and work whether or not either person is in the world. Include delivery and read receipts (users can turn read receipts off), a typing indicator, message history with pagination, and editing within 5 min (shown as "edited") and deletion.
- **Group chats:** up to 20 friends, with a name and a pixel icon.
- **Letters (mail):** asynchronous, pixel-stationery letters delivered to the recipient's in-world **mailbox**. Items can be attached (this is also the gifting system). Letters feel special and slow compared with DMs; they appear in the mailbox and the mailbox flag goes up.
- **Emotes:** a quick wheel of 8 animated emotes (wave, heart, laugh, !, ?, zzz, music, cry) shown above the head.

### 7.2 Must-haves
- **Push notifications** (Web Push + APNs/FCM via Capacitor) for DMs, letters, friend requests and friend-arrived-at-your-home. Every type can be turned off individually. Support quiet hours.
- **Offline delivery:** messages sent to offline users are stored and delivered on their next connect, in order, with no duplicates (use client-generated message IDs for idempotency).
- **Chat UI** is a React overlay that works one-handed on a phone and does not pause the world.
- **Images:** users can send in-game **screenshots/postcards** (captures of the game canvas). Uploading arbitrary photos is *off* in v1, to keep moderation simple.
- Links are shown as plain text, not clickable, in v1.

---

## 8. Friends, privacy and safety (non-negotiable)

- **Friends are mutual:** a request must be accepted. Players can add friends by handle, a **friend code**, a scannable **QR code**, opt-in contact discovery, or by tapping a player in-world.
- **Block:** the blocked player disappears for the blocker (they can't see each other, message each other, or enter each other's homes). Blocking is silent to the blocked player.
- **Mute:** hides a player's messages without blocking them.
- **Report:** available on any player, message, letter, home or item name. The report captures the relevant message context, with timestamps, for the moderation queue.
- **Defaults:** DMs from friends only. Home is friends-only. The user is findable by handle, and not findable by phone or email unless they opt in.
- **Filters:** a configurable profanity/slur filter on all public text (handles, display names, bios, Say, item names). It is on by default for Say and can be adjusted for DMs between friends.
- **Rate limits:** on messaging, friend requests and trade requests, to stop spam.
- **Moderation tools** (`apps/admin`, a simple web page): a report queue, account lookup by handle, message context around reported items, warn/mute/suspend/ban actions, and an audit log of every moderator action.
- **Minors:** if the minimum age is below 18, users under 18 get stricter defaults (friends-only everything, no contact discovery). This cannot be relaxed until they turn 18.
- **Wellbeing:** no streaks that punish absence, no infinite scroll, no public like counts. An optional "time played today" display.

---

## 9. Items, inventory and trading

### 9.1 Items
- Categories: **cosmetics** (clothes, hats), **furniture** (for homes), **collectibles** (bugs, fish, stickers), **consumables** (food with emote effects, fireworks) and **stationery** (letter designs).
- Each item definition lives in `packages/shared/items/*.json`: `id`, `name`, `category`, `rarity` (common/uncommon/rare), `tradeable`, `stackable`, `maxStack`, `sprite`, `description`.
- Every owned item is a row with an owner and quantity (non-stackable items get their own row and ID). **All item changes happen on the server inside a database transaction.** The client never decides what a player owns.

### 9.2 Getting items
- Daily login gift (no streak penalty), fishing and bug catching in the park (simple timing mini-games), the café (buy food with coins), gifts from friends, seasonal events, and crafting (combine items at a workbench).
- **Coins** are earned from activities and from selling at the Trading Post. There are sinks (furniture, clothes and stationery shops) to keep the economy stable. Log every coin change in a ledger table.

### 9.3 Trading
- A player initiates a trade by walking up to a friend and choosing *Trade*, or from their profile. **Trading is friends-only in v1.**
- A two-panel trade window: each side adds up to 8 items and/or coins.
- **Changing the offer resets both players' "Ready".** Both must press Ready, then a final **Confirm** that shows a summary of exactly what they give and receive.
- The server runs the swap in one atomic transaction: it re-checks ownership, locks the rows, swaps, and writes a `trades` record with both sides' contents. If anything fails, nothing changes.
- There is a 10-second cooldown between trades with the same person, and a trade history on the profile.
- **Gifting** (one-way) goes through letters with attachments, using the same transaction guarantees.
- Items marked `tradeable: false` (e.g. event rewards) cannot be traded.

---

## 10. More features (build the hooks in v1, ship them in later phases)

These fit the "hang out with friends" goal. Build the data model so they can be added later without a rewrite.

1. **Home decorating:** place, rotate and remove furniture on a grid, with wallpaper and flooring. Friends can visit and leave a note in a guestbook.
2. **Mini-games for 2–4 friends:** a board-game table in the café (checkers and a simple card game), a fishing contest, and a picnic blanket for sitting together.
3. **Shared activities:** sitting on benches together, a campfire that friends can gather around, and a photo booth that takes a group screenshot postcard.
4. **Calendar and events:** "Hang out Friday 8pm at my place". Invitees get a push notification and an in-world poster.
5. **Status:** a one-line status and a mood icon above the head ("studying", "free to talk").
6. **Friend gardens:** plant a seed in a friend's yard. It grows over real days and both of you can water it.
7. **Pets:** a small companion that follows you (cosmetic only).
8. **Seasonal world changes:** snow in winter, festivals, limited items.
9. **Proximity voice chat** (Section 0, #8).
10. **Creator tools:** later, let players design their own clothing patterns on a 16×16 grid, with moderation.

---

## 11. Architecture and data rules

### 11.1 Networking
- The client connects over **WebSocket** to Colyseus rooms: `town:<shard>`, `home:<userId>`, `hangout:<id>`.
- Server tick is 20 Hz; the client renders at 60 fps and interpolates remote players.
- Every client message is validated with a zod schema from `packages/shared`. Reject anything that fails validation or arrives too fast.
- DMs, letters and trades go through **authenticated HTTP/RPC endpoints** backed by Postgres (not room state), so they work outside the world and survive server restarts. The game server pushes "new message" events to connected clients.
- Reconnection: if the connection drops, reconnect with backoff and resume the room within 30 seconds without losing position.

### 11.2 Database (minimum tables)
`profiles`, `appearances`, `friendships`, `friend_requests`, `blocks`, `conversations`, `conversation_members`, `messages`, `letters`, `letter_attachments`, `item_definitions`, `inventory_items`, `coin_ledger`, `trades`, `trade_items`, `homes`, `home_furniture`, `reports`, `moderation_actions`, `push_subscriptions`, `devices`, `settings`.

- RLS on every table. A user can only read their own rows plus what friendships and settings explicitly allow.
- Keep personal data (phone, email, DOB) in a separate table that only the auth service and the user can read.
- All migrations live in `supabase/migrations` and are reversible. Seed scripts create test users and items.

### 11.3 Security checklist
- Server-authoritative movement, inventory, coins and trades.
- No secrets in the client bundle. Service keys are server-only.
- Input sanitization everywhere text is rendered (React escapes; Phaser text also gets sanitized).
- Rate limiting per IP and per user.
- Dependency audit in CI.

### 11.4 Performance budgets
- Initial client download ≤ 3 MB gzipped, excluding lazy-loaded music.
- Time to interactive in the Town Square ≤ 4 s on a mid-range phone over 4G.
- A steady 60 fps with 50 players visible on a 2021 mid-range Android phone.
- A DM reaches an online recipient in ≤ 300 ms at p95.
- One server instance handles ≥ 500 concurrent connections (prove it with the load test).

---

## 12. Phases and acceptance criteria

### Phase 1 — Foundation
Monorepo, CI, local dev stack, Supabase schema and RLS for profiles/settings, phone + email sign-up with the age gate, handle selection, and character creation with saved appearance.
**Done when:** a new user can sign up with phone *or* email on web and mobile, create a character, sign out, sign back in with the other method after linking it, and see the same character. Tests cover OTP rate limits and the age gate.

### Phase 2 — The world
Town Square map (Tiled), grid movement, collisions, NPC signposts with dialogue boxes, camera, the Pocket-mode shader, day/night tint, and multiplayer presence in a shared instance.
**Done when:** two browsers see each other walk around smoothly. A reconnect after a network drop restores position. The 50-player load test passes the frame budget.

### Phase 3 — Friends and talking
Friend requests (handle, code, QR), block/mute/report, Say bubbles, emotes, DMs and group chats with receipts, push notifications, and offline delivery.
**Done when:** a Playwright test covers A friends B, A DMs B while B is offline, B gets the message on login, and B blocks A so A can no longer message or see B. Push notifications arrive on a real device.

### Phase 4 — Homes, items and trading
Private homes with access settings, inventory UI, item definitions, coins and ledger, shops, letters with attachments, and friend trading.
**Done when:** tests show a trade is atomic (killing the server mid-trade leaves both inventories unchanged), duplicate submits don't duplicate items, and changing an offer resets Ready.

### Phase 5 — Polish and safety
Admin moderation tool, account deletion and data export, accessibility options, audio, onboarding tutorial (a friendly NPC walks the new player through talking, emotes and adding a friend), and the app store builds.
**Done when:** an accessibility pass (keyboard-only play, screen reader on menus) is complete, the moderation flow works end-to-end, and iOS/Android builds run on real devices.

### Phase 6+ — Section 10 features, in the order the product owner chooses.

---

## 13. How to work

- Before writing code in each phase, write a short plan in `docs/phase-N.md`: files to create, schema changes and test cases. Then implement it.
- Commit in small, meaningful steps with clear messages.
- When a requirement here is ambiguous, pick the option that is **safer for users' privacy and data**, note it in `docs/decisions.md`, and continue. Do not stop to ask unless it blocks progress.
- Do not add features that are not in this document without noting them in `docs/decisions.md` first.
- Keep `README.md` current: how to run it locally, environment variables (with a `.env.example`, never real secrets), and how to run tests.
- Credit every third-party asset, font and sound in `CREDITS.md` with its license.

---

## 14. Things the product owner still needs to provide (not the agent's job)

- Final game name, logo and domain.
- Twilio (or other SMS) account and budget. SMS sign-in costs money per message, and prices vary by country.
- Apple Developer ($99/yr) and Google Play ($25 one-time) accounts.
- Real Terms of Service and Privacy Policy reviewed by a lawyer, especially for minors, GDPR (EU) and CCPA (California).
- A moderation plan: who reviews reports and how fast.
- Final art and music, or a budget to commission them.
