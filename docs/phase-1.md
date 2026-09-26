# Phase 1: Foundation

Spec: PROMPT.md Section 13, Phase 1.

> **Done when:** a new user can sign up with phone _or_ email on web and mobile, create a character, sign out, sign back in with the other method after linking it, and see the same character. Tests cover OTP rate limits and the age gate.

## Plan

1. **Monorepo and tooling:** pnpm workspaces, strict TypeScript, ESLint, Prettier, Husky + lint-staged, GitHub Actions CI.
2. **Shared rules** (`packages/shared`): age check, E.164 phone check, handle validation (reserved names, profanity), profile field limits, appearance catalog and zod schema, API request schemas.
3. **Database** (`supabase/migrations/20260926000001_phase1_accounts.sql`):
   - `personal_data` (DOB, terms), `profiles` (citext unique handle), `appearances` (jsonb), `settings`.
   - RLS on every table: users read only their own rows, and clients can't write at all (writes go through the server).
   - A trigger that refuses a profile until the age gate and terms are done.
   - `save_character()` writes profile details and appearance in one transaction.
4. **API server** (`apps/server`):
   - OTP send/verify in front of Supabase Auth. Enforces 10-minute codes, 5 attempts per code, 3 sends per number/email per hour, per-IP limits and an optional captcha.
   - Endpoints for the age gate (blocks and bans under-13s, stores no DOB), terms, handle, character, `/api/me`, and linking a second sign-in method.
5. **Client** (`apps/client`):
   - Sign-in by phone (country picker) or email (code, magic link or password).
   - Onboarding screens, then the character creator with a live walking/rotating preview, Randomize and Undo.
   - Home with Wardrobe and Account (link phone/email, set a password, sign out other devices).
6. **Sprites:** a key-color sheet format, a placeholder sheet generator (121 sheets), and a runtime palette-swap compositor.
7. **Mobile:** a Capacitor config that wraps the web build.

## Tests

| Suite                           | Covers                                                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` (16)          | Age edge cases (birthday today, Feb 29, future dates), handle rules, the profanity filter including Scunthorpe-style false positives, phone format, appearance validation (500 random appearances, bad IDs, extra fields).                                                       |
| `apps/server` unit (25)         | OTP: 3 sends/hour per target, per-IP limit, captcha, 5 attempts, 10-minute expiry, no code reuse. Linking. Age gate: blocks, no DOB stored, ban, neutral message. Onboarding order, terms version, handle uniqueness and rules, character validation, auth required.             |
| `apps/server` db (6)            | Against real local Supabase: phone sign-up to character, case-insensitive handle uniqueness, under-age block and ban, linking email to a phone account and signing in with it, RLS (read own only, no direct writes, no RPC), onboarding trigger.                                |
| `apps/client` unit (6)          | Layer order, a sheet exists for every option × body, color mapping, recolor/stack.                                                                                                                                                                                               |
| e2e (2 tests × phone + desktop) | The full "done when" flow: phone sign-up → wrong code shows tries left → age → terms → handle → character → link email → sign out → sign in by email code → same character, pixel for pixel → sign in by magic link. Also the under-13 block, including trying to sign in again. |

## Status: done, with these caveats

- **Mobile:** the Capacitor config is in place, but no native build has been run on a device. That needs Android Studio / Xcode and is scheduled for Phase 6 ("iOS/Android builds run on real devices"). The e2e suite runs at a Pixel 7 viewport.
- **Real SMS:** only tested with Supabase test numbers. Production needs a Twilio account (PROMPT.md Section 15).
