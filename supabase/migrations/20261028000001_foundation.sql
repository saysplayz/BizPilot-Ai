-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0001 Foundation
-- Profiles, businesses, memberships, shared helpers.
--
-- Conventions used across all migrations
--   * Money is stored as BIGINT minor units (pesewas for GHS). Never floats.
--   * Timestamps are TIMESTAMPTZ (stored in UTC). Business dates are DATE values
--     interpreted in the business's timezone (Africa/Accra, UTC+0, no DST).
--   * Every business-owned row carries business_id and is protected by RLS.
--   * Helper functions that must not be exposed through the PostgREST API live
--     in the `private` schema.
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

-- Functions are NOT executable by PUBLIC (which includes anon) by default.
-- Every RPC is granted explicitly to `authenticated`; private helpers are
-- never granted except the two RLS predicates (see 0008).
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.business_role as enum ('owner', 'manager', 'staff');

create type public.business_type as enum (
  'electronics', 'clothing', 'cosmetics', 'minimart', 'wholesale', 'other'
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Businesses and memberships
-- ---------------------------------------------------------------------------
create table public.businesses (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (char_length(btrim(name)) between 1 and 120),
  business_type           public.business_type not null default 'other',
  currency                char(3) not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  timezone                text not null default 'Africa/Accra',
  min_cash_reserve_minor  bigint check (min_cash_reserve_minor is null or min_cash_reserve_minor >= 0),
  opening_balance_set_at  timestamptz,
  is_demo                 boolean not null default false,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on column public.businesses.is_demo is
  'True for the fictional hackathon demo business. Demo data never mixes with real businesses.';
comment on column public.businesses.opening_balance_set_at is
  'Null until an opening cash balance is recorded; forecasts are flagged incomplete while null.';

create table public.business_memberships (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.business_role not null default 'staff',
  created_at   timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_memberships_user_idx on public.business_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Authorisation helpers
-- SECURITY DEFINER so RLS policies can call them without recursive RLS on
-- business_memberships. They only ever answer questions about auth.uid().
-- ---------------------------------------------------------------------------
create or replace function private.is_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business_id and m.user_id = auth.uid()
  );
$$;

create or replace function private.has_role(p_business_id uuid, p_roles public.business_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_memberships m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

-- Raises SQLSTATE 42501 (insufficient_privilege) when the caller lacks access.
create or replace function private.assert_member(
  p_business_id uuid,
  p_roles public.business_role[] default array['owner','manager','staff']::public.business_role[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_business_id is null or not private.has_role(p_business_id, p_roles) then
    raise exception 'You do not have permission to perform this action for this business'
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger businesses_touch before update on public.businesses
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log (append-only). Written by posting functions and master-data
-- triggers. Never updated or deleted by application roles.
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  actor_id     uuid references auth.users (id) on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index audit_events_business_idx on public.audit_events (business_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

create or replace function private.audit(
  p_business_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, details)
  values (p_business_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;
