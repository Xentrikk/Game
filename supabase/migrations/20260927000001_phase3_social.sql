-- Phase 3: friends, blocking, reports, chat and push subscriptions.
-- As in Phase 1, clients can only READ (their own rows); every write goes through apps/server.

-- ---------- Friends ----------

alter table public.profiles add column friend_code text unique
  check (friend_code ~ '^[A-HJ-NP-Z2-9]{8}$');

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles (user_id) on delete cascade,
  to_user uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user, to_user),
  check (from_user <> to_user)
);
create index friend_requests_to_user on public.friend_requests (to_user);

-- One row per pair, stored with user_a < user_b.
create table public.friendships (
  user_a uuid not null references public.profiles (user_id) on delete cascade,
  user_b uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_user_b on public.friendships (user_b);

create table public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index blocks_blocked on public.blocks (blocked);

create table public.mutes (
  muter uuid not null references auth.users (id) on delete cascade,
  muted uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter, muted),
  check (muter <> muted)
);

-- Reports keep working even if either account is deleted later.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references auth.users (id) on delete set null,
  target_user uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('user', 'message', 'say', 'profile')),
  target_id text,
  reason text not null check (reason in ('harassment', 'hate', 'sexual', 'spam', 'self_harm', 'impersonation', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  context jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz not null default now()
);
create index reports_open on public.reports (created_at) where status = 'open';

-- ---------- Chat ----------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  name text not null default '' check (char_length(name) <= 30),
  icon text not null default '',
  -- For DMs: "<smaller uuid>:<larger uuid>", so a pair has exactly one DM.
  dm_key text unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seq bigint not null default 0,
  check ((kind = 'dm') = (dm_key is not null))
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Messages at or before these positions have been delivered to / read by this member.
  delivered_seq bigint not null default 0,
  read_seq bigint not null default 0,
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
create index conversation_members_user on public.conversation_members (user_id);

create table public.messages (
  -- Chosen by the sending client, so a retried send is recognised instead of duplicated.
  id uuid primary key,
  seq bigint generated always as identity unique,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index messages_conversation_seq on public.messages (conversation_id, seq desc);

-- ---------- Push ----------

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

-- ---------- Helpers ----------

create function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks
    where (blocker = a and blocked = b) or (blocker = b and blocked = a)
  );
$$;

create function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where user_a = least(a, b) and user_b = greatest(a, b)
  );
$$;

-- Accepts a request addressed to `me`. Returns the new friend's id, or null if there was no such request.
create function public.accept_friend_request(p_request uuid, p_me uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_from uuid;
begin
  delete from public.friend_requests where id = p_request and to_user = p_me returning from_user into v_from;
  if v_from is null then return null; end if;
  -- The pair may have become blocked since the request was sent.
  if public.is_blocked_between(v_from, p_me) then return null; end if;
  insert into public.friendships (user_a, user_b) values (least(v_from, p_me), greatest(v_from, p_me))
    on conflict do nothing;
  delete from public.friend_requests where from_user = p_me and to_user = v_from;
  return v_from;
end $$;

-- Blocking ends the friendship and any pending requests in both directions.
create function public.block_user(p_blocker uuid, p_blocked uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.blocks (blocker, blocked) values (p_blocker, p_blocked) on conflict do nothing;
  delete from public.friendships
    where user_a = least(p_blocker, p_blocked) and user_b = greatest(p_blocker, p_blocked);
  delete from public.friend_requests
    where (from_user = p_blocker and to_user = p_blocked) or (from_user = p_blocked and to_user = p_blocker);
end $$;

-- Idempotent send. Returns the stored message (the existing one if this id was already sent).
create function public.send_message(p_id uuid, p_conversation uuid, p_sender uuid, p_body text)
returns setof public.messages
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.messages;
  v_row public.messages;
begin
  select * into v_existing from public.messages where id = p_id;
  if found then
    if v_existing.sender_id is distinct from p_sender or v_existing.conversation_id <> p_conversation then
      raise exception 'message id already used' using errcode = 'unique_violation';
    end if;
    return next v_existing;
    return;
  end if;
  if not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation and user_id = p_sender
  ) then
    raise exception 'not a member' using errcode = 'insufficient_privilege';
  end if;
  insert into public.messages (id, conversation_id, sender_id, body)
    values (p_id, p_conversation, p_sender, p_body) returning * into v_row;
  update public.conversations set last_seq = v_row.seq where id = p_conversation;
  -- The sender has obviously seen their own message.
  update public.conversation_members set delivered_seq = v_row.seq, read_seq = v_row.seq
    where conversation_id = p_conversation and user_id = p_sender;
  return next v_row;
end $$;

-- ---------- RLS: read your own things; no client writes ----------

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.mutes enable row level security;
alter table public.reports enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own requests" on public.friend_requests for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));
create policy "own friendships" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
create policy "own blocks" on public.blocks for select to authenticated
  using ((select auth.uid()) = blocker);
create policy "own mutes" on public.mutes for select to authenticated
  using ((select auth.uid()) = muter);
create policy "own reports" on public.reports for select to authenticated
  using ((select auth.uid()) = reporter);
-- Membership check that bypasses RLS; policies on conversation_members can't query that table
-- directly without recursing into themselves.
create function public.is_conversation_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and user_id = (select auth.uid())
  );
$$;

create policy "member conversations" on public.conversations for select to authenticated
  using (public.is_conversation_member(id));
create policy "member rows" on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "member messages" on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "own push subscriptions" on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.friend_requests, public.friendships, public.blocks, public.mutes, public.reports,
  public.conversations, public.conversation_members, public.messages, public.push_subscriptions
  from anon, authenticated;
grant select on public.friend_requests, public.friendships, public.blocks, public.mutes, public.reports,
  public.conversations, public.conversation_members, public.messages, public.push_subscriptions
  to authenticated;
revoke execute on function public.accept_friend_request(uuid, uuid), public.block_user(uuid, uuid),
  public.send_message(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.is_blocked_between(uuid, uuid), public.are_friends(uuid, uuid),
  public.is_conversation_member(uuid) from public, anon;
