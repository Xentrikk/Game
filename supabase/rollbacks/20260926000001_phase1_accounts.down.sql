-- Reverses supabase/migrations/20260926000001_phase1_accounts.sql.
-- Run manually: psql "$DB_URL" -f supabase/rollbacks/20260926000001_phase1_accounts.down.sql
drop trigger if exists profiles_onboarding_order on public.profiles;
drop table if exists public.appearances;
drop table if exists public.profiles;
drop table if exists public.settings;
drop table if exists public.personal_data;
drop function if exists public.enforce_onboarding_order();
drop function if exists public.touch_updated_at();
drop function if exists public.save_character(uuid, text, text, text, jsonb);
