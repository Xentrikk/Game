-- Reverses supabase/migrations/20260927000002_phase4_economy.sql.
drop function if exists public.execute_trade(uuid, integer);
drop function if exists public.cancel_trade(uuid, uuid);
drop function if exists public.set_trade_ready(uuid, uuid, boolean);
drop function if exists public.update_trade_offer(uuid, uuid, jsonb, bigint);
drop function if exists public.open_trade(uuid, uuid);
drop function if exists public.is_trade_participant(uuid);
drop function if exists public.claim_daily_gift(uuid, integer, text, boolean);
drop function if exists public.remove_items(uuid, text, integer);
drop function if exists public.grant_item(uuid, text, integer, boolean);
drop function if exists public.adjust_coins(uuid, bigint, text, uuid);

drop table if exists public.trade_items;
drop table if exists public.trades;
drop table if exists public.letter_attachments;
drop table if exists public.letters;
drop table if exists public.home_furniture;
drop table if exists public.home_guests;
drop table if exists public.homes;
drop table if exists public.daily_gifts;
drop table if exists public.economy_idempotency;
drop table if exists public.inventory_items;
drop table if exists public.coin_ledger;
drop table if exists public.wallets;
