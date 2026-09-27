-- Phase 4: homes, inventory, coins, shops, letters and trading (PROMPT.md Sections 6.1 and 9).
-- As in earlier phases, clients can only READ their own rows; every write goes through apps/server,
-- which connects directly as the database owner (DATABASE_URL) and enforces every rule below itself.
-- Item *definitions* are not a table here — they live in packages/shared/items/*.json, and the server
-- validates every item id a client sends against that catalog before it ever reaches these tables.

-- ---------- Wallet and coin ledger ----------

create table public.wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta bigint not null check (delta <> 0),
  balance_after bigint not null,
  reason text not null check (
    reason in ('daily_gift', 'shop_purchase', 'shop_sale', 'trade', 'letter_sent', 'letter_claimed', 'admin')
  ),
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index coin_ledger_user on public.coin_ledger (user_id, created_at desc);

-- ---------- Inventory ----------

-- Every owned item is a row (PROMPT.md Section 9.1). Stackable items get exactly one row per
-- (owner, item) with a quantity; non-stackable items get one row per unit, always quantity 1.
-- `stackable` is copied from the catalog at write time so the database itself can enforce "one row
-- per stackable item" without needing to know the catalog.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null,
  quantity integer not null check (quantity > 0),
  stackable boolean not null,
  acquired_at timestamptz not null default now()
);
create unique index inventory_items_stackable_unique on public.inventory_items (owner_id, item_id) where stackable;
create index inventory_items_owner on public.inventory_items (owner_id);

-- Lets a client-generated key make a purchase, sale, daily-gift claim or letter-send safe to retry:
-- the same key can only be spent once per user. Sized to be cheap to keep forever (no cleanup job yet).
create table public.economy_idempotency (
  user_id uuid not null references auth.users (id) on delete cascade,
  key uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.daily_gifts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_claimed_on date not null,
  -- Flavor only ("Day 12!"); missing a day never resets or punishes it (PROMPT.md Section 9.2).
  claim_count integer not null default 1
);

-- ---------- Homes ----------

create table public.homes (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  access text not null default 'friends' check (access in ('friends', 'invite', 'closed')),
  updated_at timestamptz not null default now()
);

-- The allow-list for "Invite only" homes.
create table public.home_guests (
  home_owner uuid not null references public.homes (user_id) on delete cascade,
  guest_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (home_owner, guest_id)
);

-- One item per tile (PROMPT.md Section 11.1's decorating hook). Rotation, wallpaper and flooring are
-- deferred; see docs/decisions.md.
create table public.home_furniture (
  id uuid primary key default gen_random_uuid(),
  home_owner uuid not null references public.homes (user_id) on delete cascade,
  item_id text not null,
  x smallint not null check (x >= 0),
  y smallint not null check (y >= 0),
  placed_at timestamptz not null default now(),
  unique (home_owner, x, y)
);

-- ---------- Letters (mail and gifting) ----------

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references auth.users (id) on delete set null,
  to_user uuid not null references auth.users (id) on delete cascade,
  subject text not null default '' check (char_length(subject) <= 60),
  body text not null check (char_length(body) <= 1000),
  stationery_id text not null default 'plain_paper',
  coins bigint not null default 0 check (coins >= 0),
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  claimed_at timestamptz
);
create index letters_to_user on public.letters (to_user, sent_at desc);
create index letters_from_user on public.letters (from_user, sent_at desc);

create table public.letter_attachments (
  letter_id uuid not null references public.letters (id) on delete cascade,
  item_id text not null,
  quantity integer not null check (quantity > 0),
  primary key (letter_id, item_id)
);

-- ---------- Trading ----------

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  a_coins bigint not null default 0 check (a_coins >= 0),
  b_coins bigint not null default 0 check (b_coins >= 0),
  a_ready boolean not null default false,
  b_ready boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  check (user_a <> user_b)
);
-- Only one OPEN trade per pair at a time, regardless of who opened it.
create unique index trades_open_pair on public.trades (least(user_a, user_b), greatest(user_a, user_b))
  where status = 'open';
create index trades_user_a on public.trades (user_a, completed_at desc);
create index trades_user_b on public.trades (user_b, completed_at desc);

-- `stackable` is copied in at offer time (from the catalog), the same way inventory_items does it, so
-- execute_trade never has to guess it back out of rows it may have just emptied.
create table public.trade_items (
  trade_id uuid not null references public.trades (id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  item_id text not null,
  quantity integer not null check (quantity > 0),
  stackable boolean not null,
  primary key (trade_id, side, item_id)
);

-- ---------- Functions: wallet and inventory primitives ----------

-- The core wallet mutator. Every coin movement goes through this, so every movement is logged and the
-- `balance >= 0` constraint is what actually stops anyone spending coins they don't have.
create function public.adjust_coins(p_user uuid, p_delta bigint, p_reason text, p_ref_id uuid default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_balance bigint;
begin
  insert into public.wallets (user_id) values (p_user) on conflict do nothing;
  update public.wallets set balance = balance + p_delta, updated_at = now()
    where user_id = p_user
    returning balance into v_balance;
  insert into public.coin_ledger (user_id, delta, balance_after, reason, ref_id)
    values (p_user, p_delta, v_balance, p_reason, p_ref_id);
  return v_balance;
end $$;

-- Adds an item to someone's inventory. `p_stackable` comes from the caller (the shared catalog is
-- code, not a table), and must match what's already stored for that item if a row exists.
create function public.grant_item(p_owner uuid, p_item_id text, p_quantity integer, p_stackable boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_quantity <= 0 then
    return;
  end if;
  if p_stackable then
    insert into public.inventory_items (owner_id, item_id, quantity, stackable)
      values (p_owner, p_item_id, p_quantity, true)
      on conflict (owner_id, item_id) where stackable
      do update set quantity = public.inventory_items.quantity + excluded.quantity;
  else
    for i in 1..p_quantity loop
      insert into public.inventory_items (owner_id, item_id, quantity, stackable)
        values (p_owner, p_item_id, 1, false);
    end loop;
  end if;
end $$;

-- Removes up to p_quantity of an item, oldest rows first, locking every row it touches. Works for both
-- stackable (one row, decremented) and non-stackable (many rows, deleted) the same way. Raises if the
-- owner doesn't have enough — this is the "re-checks ownership" step PROMPT.md Section 9.3 asks for.
create function public.remove_items(p_owner uuid, p_item_id text, p_quantity integer)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  remaining integer := p_quantity;
begin
  if p_quantity <= 0 then
    return;
  end if;
  for r in
    select id, quantity from public.inventory_items
    where owner_id = p_owner and item_id = p_item_id
    order by acquired_at, id
    for update
  loop
    exit when remaining <= 0;
    if r.quantity <= remaining then
      delete from public.inventory_items where id = r.id;
      remaining := remaining - r.quantity;
    else
      update public.inventory_items set quantity = r.quantity - remaining where id = r.id;
      remaining := 0;
    end if;
  end loop;
  if remaining > 0 then
    raise exception 'insufficient_items' using errcode = 'check_violation';
  end if;
end $$;

-- One claim per UTC calendar day. No streak to break: missing days never changes the reward.
create function public.claim_daily_gift(p_user uuid, p_coins integer, p_item_id text, p_item_stackable boolean)
returns table (claimed boolean, balance bigint, claim_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.daily_gifts;
  v_balance bigint;
begin
  insert into public.daily_gifts (user_id, last_claimed_on, claim_count)
    values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id) do update
    set last_claimed_on = excluded.last_claimed_on,
        claim_count = public.daily_gifts.claim_count + 1
    where public.daily_gifts.last_claimed_on < excluded.last_claimed_on
  returning * into v_row;

  if not found then
    select w.balance into v_balance from public.wallets w where w.user_id = p_user;
    select d.* into v_row from public.daily_gifts d where d.user_id = p_user;
    return query select false, coalesce(v_balance, 0), v_row.claim_count;
    return;
  end if;

  v_balance := public.adjust_coins(p_user, p_coins, 'daily_gift', null);
  if p_item_id is not null then
    perform public.grant_item(p_user, p_item_id, 1, p_item_stackable);
  end if;
  return query select true, v_balance, v_row.claim_count;
end $$;

-- ---------- Functions: trading ----------

create function public.is_trade_participant(p_trade uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trades where id = p_trade and (select auth.uid()) in (user_a, user_b)
  );
$$;

-- Opens a trade with a friend, or returns the one already open between you. Enforces the 10-second
-- cooldown between trades with the same person (PROMPT.md Section 9.3), measured from the last one
-- that actually completed.
create function public.open_trade(p_a uuid, p_b uuid) returns public.trades
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
  v_last_completed timestamptz;
begin
  select * into v_trade from public.trades
    where status = 'open'
      and least(user_a, user_b) = least(p_a, p_b)
      and greatest(user_a, user_b) = greatest(p_a, p_b);
  if found then
    return v_trade;
  end if;

  select max(completed_at) into v_last_completed from public.trades
    where status = 'completed'
      and least(user_a, user_b) = least(p_a, p_b)
      and greatest(user_a, user_b) = greatest(p_a, p_b);
  if v_last_completed is not null and now() - v_last_completed < interval '10 seconds' then
    raise exception 'trade_cooldown' using errcode = 'check_violation';
  end if;

  insert into public.trades (user_a, user_b) values (p_a, p_b) returning * into v_trade;
  return v_trade;
end $$;

-- Replaces the caller's side of the offer. Changing the offer resets BOTH players' Ready, every time
-- (PROMPT.md Section 9.3) — that's the whole point of this function existing instead of a plain UPDATE.
create function public.update_trade_offer(p_trade uuid, p_user uuid, p_items jsonb, p_coins bigint)
returns public.trades
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
  v_side text;
begin
  select * into v_trade from public.trades where id = p_trade for update;
  if not found or v_trade.status <> 'open' then
    raise exception 'trade_not_open' using errcode = 'no_data_found';
  end if;
  if v_trade.user_a = p_user then
    v_side := 'a';
  elsif v_trade.user_b = p_user then
    v_side := 'b';
  else
    raise exception 'not_a_participant' using errcode = 'insufficient_privilege';
  end if;

  delete from public.trade_items where trade_id = p_trade and side = v_side;
  insert into public.trade_items (trade_id, side, item_id, quantity, stackable)
    select p_trade, v_side, elem ->> 'itemId', (elem ->> 'quantity')::int, (elem ->> 'stackable')::boolean
    from jsonb_array_elements(p_items) as elem;

  update public.trades set
      a_coins = case when v_side = 'a' then p_coins else a_coins end,
      b_coins = case when v_side = 'b' then p_coins else b_coins end,
      a_ready = false,
      b_ready = false
    where id = p_trade
    returning * into v_trade;
  return v_trade;
end $$;

create function public.set_trade_ready(p_trade uuid, p_user uuid, p_ready boolean)
returns public.trades
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
begin
  select * into v_trade from public.trades where id = p_trade for update;
  if not found or v_trade.status <> 'open' then
    raise exception 'trade_not_open' using errcode = 'no_data_found';
  end if;
  if v_trade.user_a = p_user then
    update public.trades set a_ready = p_ready where id = p_trade returning * into v_trade;
  elsif v_trade.user_b = p_user then
    update public.trades set b_ready = p_ready where id = p_trade returning * into v_trade;
  else
    raise exception 'not_a_participant' using errcode = 'insufficient_privilege';
  end if;
  return v_trade;
end $$;

create function public.cancel_trade(p_trade uuid, p_user uuid) returns public.trades
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
begin
  select * into v_trade from public.trades where id = p_trade for update;
  if not found then
    raise exception 'trade_not_found' using errcode = 'no_data_found';
  end if;
  if v_trade.user_a <> p_user and v_trade.user_b <> p_user then
    raise exception 'not_a_participant' using errcode = 'insufficient_privilege';
  end if;
  if v_trade.status = 'open' then
    update public.trades set status = 'cancelled', cancelled_at = now() where id = p_trade returning * into v_trade;
  end if;
  return v_trade;
end $$;

-- The atomic swap (PROMPT.md Section 9.3): re-checks ownership, locks every row it touches, swaps
-- everything in one transaction, and never runs twice for the same trade.
--
-- `p_debug_sleep_ms` is a test-only hook: it is never passed a non-zero value by application code (the
-- server's TradeRepo never exposes this parameter), only by the test suite's own direct SQL connection,
-- which uses it to pause the function here — after the locks are taken, before anything is moved — so a
-- test can terminate this backend mid-transaction and prove Postgres rolls the whole thing back.
create function public.execute_trade(p_trade uuid, p_debug_sleep_ms integer default 0)
returns public.trades
language plpgsql security definer set search_path = '' as $$
declare
  v_trade public.trades;
  v_item record;
  v_avail bigint;
begin
  select * into v_trade from public.trades where id = p_trade for update;
  if not found then
    raise exception 'trade_not_found' using errcode = 'no_data_found';
  end if;
  if v_trade.status = 'completed' then
    return v_trade; -- Already done: a duplicate submit is a no-op, not a second swap.
  end if;
  if v_trade.status <> 'open' then
    raise exception 'trade_not_open' using errcode = 'no_data_found';
  end if;
  if not (v_trade.a_ready and v_trade.b_ready) then
    raise exception 'not_both_ready' using errcode = 'check_violation';
  end if;

  -- Re-check ownership and lock every offered row before moving anything. FOR UPDATE can't sit
  -- directly on an aggregate query, so the lock happens in a subquery and the sum outside it.
  for v_item in select * from public.trade_items where trade_id = p_trade and side = 'a' loop
    select coalesce(sum(quantity), 0) into v_avail from (
      select quantity from public.inventory_items
        where owner_id = v_trade.user_a and item_id = v_item.item_id for update
    ) locked;
    if v_avail < v_item.quantity then
      raise exception 'insufficient_items' using errcode = 'check_violation';
    end if;
  end loop;
  for v_item in select * from public.trade_items where trade_id = p_trade and side = 'b' loop
    select coalesce(sum(quantity), 0) into v_avail from (
      select quantity from public.inventory_items
        where owner_id = v_trade.user_b and item_id = v_item.item_id for update
    ) locked;
    if v_avail < v_item.quantity then
      raise exception 'insufficient_items' using errcode = 'check_violation';
    end if;
  end loop;

  if p_debug_sleep_ms > 0 then
    perform pg_sleep(p_debug_sleep_ms / 1000.0);
  end if;

  for v_item in select * from public.trade_items where trade_id = p_trade and side = 'a' loop
    perform public.remove_items(v_trade.user_a, v_item.item_id, v_item.quantity);
    perform public.grant_item(v_trade.user_b, v_item.item_id, v_item.quantity, v_item.stackable);
  end loop;
  for v_item in select * from public.trade_items where trade_id = p_trade and side = 'b' loop
    perform public.remove_items(v_trade.user_b, v_item.item_id, v_item.quantity);
    perform public.grant_item(v_trade.user_a, v_item.item_id, v_item.quantity, v_item.stackable);
  end loop;

  if v_trade.a_coins > 0 then
    perform public.adjust_coins(v_trade.user_a, -v_trade.a_coins, 'trade', p_trade);
    perform public.adjust_coins(v_trade.user_b, v_trade.a_coins, 'trade', p_trade);
  end if;
  if v_trade.b_coins > 0 then
    perform public.adjust_coins(v_trade.user_b, -v_trade.b_coins, 'trade', p_trade);
    perform public.adjust_coins(v_trade.user_a, v_trade.b_coins, 'trade', p_trade);
  end if;

  update public.trades set status = 'completed', completed_at = now() where id = p_trade returning * into v_trade;
  return v_trade;
end $$;

-- ---------- RLS: read your own things; no client writes ----------

alter table public.wallets enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.inventory_items enable row level security;
alter table public.economy_idempotency enable row level security;
alter table public.daily_gifts enable row level security;
alter table public.homes enable row level security;
alter table public.home_guests enable row level security;
alter table public.home_furniture enable row level security;
alter table public.letters enable row level security;
alter table public.letter_attachments enable row level security;
alter table public.trades enable row level security;
alter table public.trade_items enable row level security;

create policy "own wallet" on public.wallets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own ledger" on public.coin_ledger for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own inventory" on public.inventory_items for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "own daily gift record" on public.daily_gifts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own home" on public.homes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "own home guest list" on public.home_guests for select to authenticated
  using ((select auth.uid()) = home_owner);
create policy "own home furniture" on public.home_furniture for select to authenticated
  using ((select auth.uid()) = home_owner);
create policy "own letters" on public.letters for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));
create policy "own letter attachments" on public.letter_attachments for select to authenticated
  using (exists (
    select 1 from public.letters l where l.id = letter_attachments.letter_id and (select auth.uid()) in (l.from_user, l.to_user)
  ));
create policy "own trades" on public.trades for select to authenticated
  using (public.is_trade_participant(id));
create policy "own trade items" on public.trade_items for select to authenticated
  using (public.is_trade_participant(trade_id));

revoke all on public.wallets, public.coin_ledger, public.inventory_items, public.economy_idempotency,
  public.daily_gifts, public.homes, public.home_guests, public.home_furniture, public.letters,
  public.letter_attachments, public.trades, public.trade_items
  from anon, authenticated;
grant select on public.wallets, public.coin_ledger, public.inventory_items, public.daily_gifts,
  public.homes, public.home_guests, public.home_furniture, public.letters, public.letter_attachments,
  public.trades, public.trade_items
  to authenticated;
revoke execute on function
  public.adjust_coins(uuid, bigint, text, uuid),
  public.grant_item(uuid, text, integer, boolean),
  public.remove_items(uuid, text, integer),
  public.claim_daily_gift(uuid, integer, text, boolean),
  public.open_trade(uuid, uuid),
  public.update_trade_offer(uuid, uuid, jsonb, bigint),
  public.set_trade_ready(uuid, uuid, boolean),
  public.cancel_trade(uuid, uuid),
  public.execute_trade(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.is_trade_participant(uuid) from public, anon;
