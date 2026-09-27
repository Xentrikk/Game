# Phase 4: Homes, inventory and trading

Spec: PROMPT.md Section 13, Phase 4, and Sections 6.4 and 9.

> **Done when:** tests show a trade is atomic (killing the server mid-trade leaves both inventories unchanged), duplicate submits don't duplicate items, and changing an offer resets Ready.

## Plan

### Items (`packages/shared/items/*.json`, `src/items.ts`)

- The catalog (23 items across cosmetics, furniture, collectibles, consumables, stationery) is code, not a database table — it ships with the client and server and never needs a migration to add an item.
- Each item: id, name, category, rarity, tradeable, stackable, maxStack, sprite, description, and optionally price/sellPrice/shop.
- `founders_badge` is deliberately non-tradeable and `plain_paper` is a free default with no shop, so the catalog's own integrity checks (and the trade/letter code) exercise both rules.

### Data (`supabase/migrations/…_phase4_economy.sql`)

- `wallets`, `coin_ledger` (append-only, every balance change has a reason and a running balance).
- `inventory_items`, with a partial unique index on `(owner_id, item_id) where stackable` so stackable items can only ever have one row.
- `economy_idempotency`: claims a client-generated key inside the same transaction as a shop purchase/sale, so a resent request is a no-op.
- `daily_gifts`: one row per user, `last_claimed_on` compared in UTC; the upsert's `where` clause makes a same-day retry naturally idempotent.
- `homes`, `home_guests` (invite list), `home_furniture` (unique `(home_owner, x, y)` — one item per tile).
- `letters`, `letter_attachments`.
- `trades`, `trade_items`; a partial unique index on the sorted pair `where status = 'open'` stops two open trades between the same two people.
- All multi-step logic is a `security definer` SQL function (`adjust_coins`, `grant_item`, `remove_items`, `claim_daily_gift`, `open_trade`, `update_trade_offer`, `set_trade_ready`, `cancel_trade`, `execute_trade`), so it's atomic by construction and easy to test by killing the connection mid-call.
  - `execute_trade` takes a test-only `p_debug_sleep_ms` parameter that sleeps after validating and before moving anything — the test suite uses it to open a window in which to kill the backend and prove the transaction rolls back. The repo layer's `confirm()` never exposes this parameter; only the test suite's own direct SQL connection can pass one.
- RLS is `select`-only and scoped to the owner/participant, exactly like Phases 1 and 3: the server (direct Postgres connection) does all the writing.

### Server

- **Wallet & inventory:** balance, ledger, inventory listing.
- **Shop:** three shops (café, boutique, general); buy debits coins and grants the item, sell removes it and credits coins, both idempotent on a client-generated key.
- **Daily gift:** coins every day, plus a 1-in-5 chance of a random collectible (common items more likely).
- **Homes:** an access setting (open to friends / invite only / closed) plus an explicit guest list for the invite-only case; owner always gets in. Furniture is decorative in v1 — it occupies a tile so two items can't overlap, but doesn't block movement.
- **Letters:** subject, body, one of several stationery designs (a free default plus purchasable ones), up to 8 attached items and/or coins. Attachments leave the sender's inventory when the letter is sent and only reach the recipient's when they claim it, so a letter in flight is already paid for.
- **Trading:** open a trade with a friend (one open trade per pair), each side sets an offer (up to 8 items + coins) and readies up; changing an offer un-readies that side; confirming when both are ready calls `execute_trade`, which locks both sides' rows, re-checks everything, moves items and coins, and marks the trade completed — once, even if called twice.
- **Live events:** the Phase 3 event stream gains `trade_updated`, `letter`, `wallet_changed`, `inventory_changed` and `home_changed`, so open panels update without polling.
- **Push:** a `letter` notification kind, off during quiet hours like the others.
- **Rooms:** `PlayerRoom` is the shared base (movement, Say, emotes, reports, block/mute visibility, one-session-per-account) that `TownRoom` already had. `HomeRoom` extends it: one Colyseus room instance per home (`filterBy(['ownerId'])`), access checked in `onAuth` before a seat is reserved (owner always allowed; otherwise `HomeRepo.canEnter`), and a small furnished map instead of the Town Square.

### Client

- **Inventory** panel (grouped by category, quantity, sell button where sellable).
- **Shop** panels for the three shops, plus sell-from-inventory.
- **Letters:** compose (pick stationery, write, attach items/coins), inbox/sent, claim.
- **Trade:** live offer editor for both sides, Ready toggles, Confirm once both are ready, updates over the live event stream.
- **Home:** a "Home" button and a "Visit home" action on a friend's profile card; the owner gets a furniture placement/removal UI; entering someone else's home respects their access setting.
- `WorldScene`/`World.tsx` are generalized to take a map/tileset/room-kind instead of hardcoding the Town Square, so the same scene renders a home.

### Tests

- Database: wallet/ledger math, shop buy/sell idempotency and error cases (not for sale, insufficient coins/items, non-tradeable, max stack), daily gift's day boundary and idempotency, home access rules including blocks, furniture placement/removal and tile conflicts, letters (send escrows attachments, claim grants them once, can't claim twice), trading end to end including **the literal kill-mid-trade test**: open a dedicated connection, start `execute_trade` with a debug sleep, `pg_terminate_backend()` it mid-sleep from a second connection, and assert both inventories and both wallets are exactly as they were before the trade.
- Room: `HomeRoom` access control (friends/invite/closed, blocked users, owner always allowed), one instance per home.
- End-to-end: the done-when flow (atomic trade, idempotent submit, offer-change resets Ready) driven through the UI, plus a full loop of shop → inventory → letter → trade → home visit.

### Deferred past this phase

Fishing/bug-catching minigames, hangout mini-rooms, and wearing cosmetic items on the character (wardrobe integration) are all mentioned as _possible_ extensions in the original brief but are not required by the Phase 4 done-criteria; they're left for a later pass so this phase stays focused on the economy and trading being correct and atomic. Furniture is placement-only (no rotation, no collision) in v1.

## Status: done

| Criterion                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A trade is atomic (killing the server mid-trade changes nothing) | DB test `trading > is atomic: killing the connection mid-trade leaves both sides completely unchanged`: opens a dedicated Postgres connection, starts `execute_trade` with a debug sleep, kills that backend mid-transaction from a second connection, and asserts both wallets and both inventories are byte-for-byte what they were before, and that the trade is still `open` and completes normally afterwards. |
| Duplicate submits don't duplicate items                          | DB tests `shop > resending the same idempotency key does not buy twice` and `trading > confirming twice does not swap twice (idempotent completion)`.                                                                                                                                                                                                                                                               |
| Changing an offer resets Ready                                   | DB test `trading > changing an offer resets both sides' Ready` and, end to end through the UI, e2e test `trades an item and coins between friends; changing an offer resets Ready`.                                                                                                                                                                                                                                 |

**Tests added in this phase:**

- **Database (27 total):** wallet/inventory basics, shop buy/sell (idempotent, insufficient coins, not-for-sale, not-sellable), the daily gift's same-day idempotency, home access (friends/invite/closed, blocked visitors, guest list, furniture placement/removal and tile conflicts), letters (friends-only, escrow on send, claim grants once, non-tradeable attachments refused, stationery ownership, self-send refused), and trading (friends-only, the full offer → ready → confirm swap, idempotent confirm, offer-change resets Ready, insufficient-items re-check at confirm time, the cooldown after a completed trade, cancellation, and the atomicity test above).
- **Room (7 total):** `HomeRoom` access control (owner always allowed, friends/invite/closed, blocked visitors, missing `ownerId`, no character), and that two visits to the same home land in the same room instance.
- **Shared (16 total):** the item catalog's own integrity checks and the new economy/home/trade/letter zod schemas.
- **End-to-end (4 total):** daily gift → shop buy → sell; a letter with an attached item and coins, escrowed on send and granted once on claim; a full trade (including the live offer-change-resets-Ready check, visible on both sides); a home's access setting turning a friend away and then letting them in once invited.

**Bugs the tests caught along the way:**

- `execute_trade`'s ownership re-check used `select sum(quantity) ... for update`, which Postgres rejects (`FOR UPDATE is not allowed with aggregate functions`) — caught immediately by the first real trade in a test, before the atomicity test ever got to the interesting part. Fixed by locking the rows in a subquery and summing outside it.
- The offline demo broke when `World.tsx` gained a direct import of the new home-management panel, which pulls in the API client and so `supabase.ts` — whose top-level code throws when Supabase env vars are absent, which is always true for the demo build. See decisions.md #56 for the fix.
- Running the new economy DB test files alongside the existing ones made a pre-existing hazard visible: every DB test file wipes all `@hearth.test` users in its own `beforeAll`, which is unsafe if Vitest runs files in parallel. Fixed by turning off file-level parallelism for DB tests (decisions.md #57).
