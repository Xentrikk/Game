-- Reverses supabase/migrations/20260927000001_phase3_social.sql.
drop function if exists public.send_message(uuid, uuid, uuid, text);
drop function if exists public.block_user(uuid, uuid);
drop function if exists public.accept_friend_request(uuid, uuid);
drop function if exists public.are_friends(uuid, uuid);
drop function if exists public.is_blocked_between(uuid, uuid);
drop table if exists public.push_subscriptions;
drop table if exists public.messages;
drop table if exists public.conversation_members;
drop table if exists public.conversations;
drop table if exists public.reports;
drop table if exists public.mutes;
drop table if exists public.blocks;
drop table if exists public.friendships;
drop table if exists public.friend_requests;
drop function if exists public.is_conversation_member(uuid);
alter table public.profiles drop column if exists friend_code;
