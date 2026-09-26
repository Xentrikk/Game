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
