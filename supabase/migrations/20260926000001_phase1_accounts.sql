-- Phase 1: accounts, onboarding and character appearance.
--
-- Clients may only READ their own rows. All writes go through apps/server using the service role,
-- which validates input with the shared zod schemas first. That is why there are no insert/update
-- policies for the `authenticated` role below.

create extension if not exists citext with schema extensions;

-- Personal data (DOB, terms acceptance) lives apart from the public profile. Phone and email stay in
-- auth.users, which clients can't query directly.
create table public.personal_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  dob date,
  age_verified_at timestamptz,
  -- Set when the age gate fails. DOB is never stored for blocked users.
  age_blocked_at timestamptz,
  tos_version text,
  privacy_version text,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blocked_has_no_dob check (age_blocked_at is null or dob is null)
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext not null unique
    check (handle ~ '^[a-z0-9_]{3,16}$'),
  display_name text not null default '' check (char_length(display_name) <= 20),
  pronouns text not null default '' check (char_length(pronouns) <= 20),
  bio text not null default '' check (char_length(bio) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appearances (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and (data ->> 'v') is not null),
  updated_at timestamptz not null default now()
);

create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- A profile can only exist once the age gate and terms are passed.
create function public.enforce_onboarding_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.personal_data p
    where p.user_id = new.user_id
      and p.age_verified_at is not null
      and p.age_blocked_at is null
      and p.terms_accepted_at is not null
  ) then
    raise exception 'age gate and terms must be completed before creating a profile'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger profiles_onboarding_order
  before insert on public.profiles
  for each row execute function public.enforce_onboarding_order();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger personal_data_touch before update on public.personal_data
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger appearances_touch before update on public.appearances
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

alter table public.personal_data enable row level security;
alter table public.profiles enable row level security;
alter table public.appearances enable row level security;
alter table public.settings enable row level security;

create policy "read own personal data" on public.personal_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own appearance" on public.appearances
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own settings" on public.settings
  for select to authenticated using ((select auth.uid()) = user_id);

-- Remove default table privileges from API roles, then grant back only what the policies need.
revoke all on public.personal_data, public.profiles, public.appearances, public.settings from anon, authenticated;
grant select on public.personal_data, public.profiles, public.appearances, public.settings to authenticated;
revoke execute on function public.enforce_onboarding_order() from public, anon, authenticated;

-- Saves profile details and appearance together, so a half-saved character can't happen.
-- Called only by apps/server (service role) after validating input.
create function public.save_character(
  p_user_id uuid,
  p_display_name text,
  p_pronouns text,
  p_bio text,
  p_appearance jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
    set display_name = p_display_name, pronouns = p_pronouns, bio = p_bio
    where user_id = p_user_id;
  if not found then
    raise exception 'profile does not exist' using errcode = 'no_data_found';
  end if;
  insert into public.appearances (user_id, data) values (p_user_id, p_appearance)
    on conflict (user_id) do update set data = excluded.data;
end $$;

revoke execute on function public.save_character(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_character(uuid, text, text, text, jsonb) to service_role;
