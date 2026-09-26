# Decisions log

Choices made where PROMPT.md was ambiguous or silent. Per Section 14, when in doubt we pick the option that's safer for users' privacy and data.

## Phase 1

1. **OTP goes through our server, not straight from the client to Supabase.** The spec's limits (5 attempts per code, 3 sends per number per hour, 10-minute expiry) are finer-grained than Supabase's built-in ones. The server enforces them with a Redis-backed store (in-memory when `REDIS_URL` is empty) and then calls Supabase Auth. Supabase's own limits still apply underneath, e.g. a minimum of a few seconds between codes to the same number.
2. **The 3-per-hour limit also applies to email addresses and to linking.** Sign-in and linking share one counter per address, so linking can't be used to get around it.
3. **Emails include both a magic link and a 6-digit code.** The spec asks for a magic link. A code is added because links are unreliable inside the mobile app (they open the browser, not the app).
4. **Under-age users:** the account is marked blocked (`age_blocked_at`, DOB never stored, enforced by a DB constraint) and banned in Supabase Auth, so the same phone/email can't retry with a different birthday. Everyone sees the same neutral message. If a blocked person later becomes eligible, support has to lift the ban manually.
5. **Clients never write to the database directly.** RLS gives the `authenticated` role read access to its own rows only, and all writes go through the API with the service role after zod validation. This is stricter than the spec requires and keeps validation in one place.
6. **Handles can be set once** in Phase 1. Changing a handle needs rules about impersonation and reuse, so it's deferred.
7. **Display name defaults to the handle**, max 20 characters. The spec gave no length.
8. **"Overalls" became "Patched pants".** A bib would have to be drawn over the top layer, which breaks the layer order in Section 5.
9. **Shoes sheets are per body shape**, like tops and bottoms, because leg positions differ by body.
10. **No Phaser yet.** Phase 1 has no world to render, so the character preview is a plain canvas using the same compositor. Phaser arrives in Phase 2 and will use the composited sheets as textures.
11. **Device list:** "Sign out other devices" is done (Supabase `signOut({ scope: "others" })`). A named list of devices is deferred to Phase 6, alongside account deletion and data export, which the spec also puts there.
12. **Contact discovery** is deferred to Phase 3 (friends), where it's needed.
13. **The profanity list is a starter list.** It must be replaced with a maintained, licensed list with non-English coverage before launch. Short words are only matched as whole words, plus an allowlist, to avoid false positives like "Scunthorpe".
14. **Native iOS/Android projects aren't committed yet.** They're generated with `cap add` once someone has the SDKs, and committed from then on.
15. **E2E tests start their own servers on ports 2568/5174**, so rate-limit state never leaks between runs. Per-IP OTP limits are configurable (`OTP_IP_SENDS_PER_HOUR`) so e2e can run many sign-ins from one machine. The per-number limits are not configurable.

## Phase 2

16. **Colyseus 0.18 and Phaser 3.90.** The spec names Phaser 3; Phaser 4 exists but changes the effects API, so we stay on 3. Colyseus 0.18 is current, and its SDK reconnects automatically, which covers the 30-second reconnect rule.
17. **The map file is `town.json`, not `town.tmj`.** It's the same Tiled JSON format (Tiled opens and saves both). The `.json` extension lets TypeScript, Vite and Node import it directly.
18. **Auth runs at matchmaking** (`static onAuth`), before a seat is reserved. The instance-level hook would let anyone without a token hold seats.
19. **Players can walk through each other.** Blocking would let people trap others in doorways or the portal. Tile collision is only for the map and NPCs.
20. **Border trees are fully solid**, canopy included. Other trees keep walk-behind canopies for depth.
21. **Leaving vs. dropping.** Closing, hiding or navigating away from the tab sends a proper leave, so friends see you go at once. Only real network drops keep your spot for 30 s, and you're shown faded meanwhile.
22. **One presence per account across all instances**, via Colyseus presence pub/sub. A newer login replaces the older one, which isn't allowed to reconnect.
23. **Speed checks use a token bucket** of 3 walk-steps (750 ms). It absorbs bursts from network jitter, but over time nobody moves faster than running speed.
24. **Name tags use a built-in 3×5 pixel font.** The 8px UI font would make a 12-letter name a third of the screen wide. Names with characters the tiny font lacks (e.g. "Zoë") show the handle instead.
25. **Scaling is by whole device pixels**, not CSS pixels, and the canvas is positioned on exact device pixels. On a Pixel 7 (DPR 2.625) that's 3 device pixels per game pixel.
26. **Portrait phones get a Game Boy layout**: the screen at the top, the text box under it, the controls at the bottom. The prompt's fixed 320×180 view leaves a lot of vertical space in portrait. A taller viewport for portrait is an option to revisit.
27. **The day/night tint and Pocket mode run in one WebGL shader.** Without WebGL, a multiply overlay handles the tint and Pocket mode is unavailable.
28. **The Pocket mode setting is stored per device** (localStorage), as a viewer preference.
29. **Local Supabase allows 5,000 sign-ins per 5 minutes** so `pnpm loadtest` can sign in hundreds of bots. Production keeps Supabase's defaults.
30. **The frame-rate test is skipped in CI unless `PERF=1`**, because shared CI runners' timing varies too much for a 60 fps assertion. It runs as part of the normal local e2e suite.

## Phase 3

31. **Live updates use server-sent events** (`GET /api/events`, read with `fetch` so the Authorization header works) over a pub/sub bus: in memory for one server, Redis for several. Chat works anywhere in the app, not only in the world. The spec's "game server pushes new message events" is met by the same server process.
32. **Social and chat queries use a direct Postgres connection** (`DATABASE_URL`, the `postgres` driver) for transactions and joins. Multi-step changes (accept a request, block someone, send a message) are SQL functions, so each is one transaction.
33. **Messages are ordered by a global sequence number**, which is also the paging and catch-up cursor. Clients generate message IDs, so a retried send can never create a duplicate.
34. **Deleted messages keep their text, hidden from everyone,** so a report can show moderators what was said. Before launch, add a job that permanently removes deleted text after 30 days unless a report holds it.
35. **Read receipts are mutual:** if either person turns them off, neither sees the other's (common practice; avoids one-sided tracking). Delivered receipts always show.
36. **DMs and groups are friends-only for everyone,** not just for minors. The spec's default is friends-only DMs, and there's no setting to open them up yet, which also satisfies the stricter rules for under-18s.
37. **Blocking is silent:** requests from a blocked person look sent but do nothing; they're never told. The blocker's friend list updates immediately. The blocked person notices the friendship is gone the next time their list loads, which can't be avoided.
38. **Muting** hides that person's Say bubbles and emotes in the world and their messages in group chats. It doesn't hide DMs (unfriend or block for that). Each chat can also be muted separately for notifications.
39. **World visibility uses Colyseus StateView:** each client only receives the players it may see, and blocks take effect immediately in every instance through the bus.
40. **Say is masked, not rejected:** profane words become asterisks so the rest of the line still gets through. Direct messages between friends aren't filtered, since there's no opt-in setting yet.
41. **Speech bubbles and emotes are HTML over the canvas,** not drawn in Phaser. They can show any language and emoji (the 3×5 pixel font can't), and screen readers can reach them. They're positioned every frame from the scene.
42. **Tapping a player** opens their card; Say reports from the world go through the room so they include the recent lines.
43. **"Go to friend" and entering town** both try the friend's instance first (`joinById`) and fall back to any instance with room.
44. **Presence is refcounted per open event stream** and stored in the shared store with a 2-minute TTL refreshed by 30-second heartbeats, so crashed servers don't leave people "online" forever.
45. **Contact discovery (opt-in phone and email matching) is deferred to Phase 6.** Browsers have no general contacts API; it needs the native apps (Capacitor). The Phase 3 list in the spec doesn't include it.
46. **Screenshot postcards in chat are deferred to Phase 4,** alongside letters. The spec lists postcards with images; Phase 3 chat is text only, and links show as plain text.
47. **The offline preview shares screens with the real app,** so shared screens import social code only through `social/contexts.ts`, which has no server imports.
