-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0006 Cash-flow scenarios, alerts, AI assistant storage
-- =============================================================================

-- Saved what-if scenarios. Scenarios NEVER touch financial records; they are
-- a list of adjustments applied in memory to a fresh baseline forecast.
create table public.cashflow_scenarios (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  description   text check (char_length(description) <= 1000),
  horizon_days  integer not null default 30 check (horizon_days in (7, 14, 30, 60, 90)),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, id)
);
create index cashflow_scenarios_business_idx on public.cashflow_scenarios (business_id, created_at desc);

-- One row per adjustment. `params` is validated by the app (Zod) per kind.
create table public.cashflow_scenario_events (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  scenario_id   uuid not null,
  position      integer not null default 0,
  kind          text not null check (kind in (
                  'one_off', 'recurring', 'delay_event', 'collect_early',
                  'sales_change_pct', 'supplier_price_change_pct', 'exclude_event')),
  params        jsonb not null default '{}'::jsonb,
  foreign key (business_id, scenario_id) references public.cashflow_scenarios (business_id, id) on delete cascade
);
create index cashflow_scenario_events_scenario_idx on public.cashflow_scenario_events (scenario_id, position);

create trigger cashflow_scenarios_touch before update on public.cashflow_scenarios
  for each row execute function private.touch_updated_at();

-- Save a scenario atomically (header + adjustments).
create or replace function public.save_cashflow_scenario(
  p_business_id uuid,
  p_name text,
  p_description text,
  p_horizon_days integer,
  p_adjustments jsonb,
  p_scenario_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.assert_member(p_business_id);
  if p_adjustments is null or jsonb_typeof(p_adjustments) <> 'array' then
    raise exception 'Scenario adjustments must be a list' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_adjustments) > 20 then
    raise exception 'A scenario can have at most 20 changes' using errcode = 'P0001';
  end if;

  if p_scenario_id is null then
    insert into public.cashflow_scenarios (business_id, name, description, horizon_days, created_by)
    values (p_business_id, private.require_text(p_name, 'Scenario name', 120), private.clean_text(p_description),
            coalesce(p_horizon_days, 30), auth.uid())
    returning id into v_id;
  else
    update public.cashflow_scenarios
       set name = private.require_text(p_name, 'Scenario name', 120),
           description = private.clean_text(p_description),
           horizon_days = coalesce(p_horizon_days, 30)
     where id = p_scenario_id and business_id = p_business_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Scenario not found' using errcode = 'P0001';
    end if;
    delete from public.cashflow_scenario_events where scenario_id = v_id;
  end if;

  insert into public.cashflow_scenario_events (business_id, scenario_id, position, kind, params)
  select p_business_id, v_id, (e.ord - 1)::integer, e.value ->> 'kind', e.value - 'kind'
    from jsonb_array_elements(p_adjustments) with ordinality as e(value, ord);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Alerts. The app derives alerts from current data; each has a fingerprint
-- built from its materially relevant values, so the same situation is not
-- re-announced, a dismissed alert stays dismissed, and a materially changed
-- situation produces a fresh alert.
-- ---------------------------------------------------------------------------
create table public.alerts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  kind           text not null,
  severity       text not null check (severity in ('info', 'warning', 'critical')),
  title          text not null,
  message        text not null,
  fingerprint    text not null,
  data           jsonb not null default '{}'::jsonb,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  dismissed_at   timestamptz,
  resolved_at    timestamptz,
  unique (business_id, fingerprint)
);
create index alerts_business_active_idx on public.alerts (business_id) where resolved_at is null and dismissed_at is null;

create or replace function public.sync_alerts(p_business_id uuid, p_alerts jsonb)
returns setof public.alerts
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  if p_alerts is null or jsonb_typeof(p_alerts) <> 'array' then
    raise exception 'Alerts must be a list' using errcode = '22023';
  end if;

  insert into public.alerts (business_id, kind, severity, title, message, fingerprint, data)
  select p_business_id, a.kind, a.severity, left(a.title, 200), left(a.message, 1000), left(a.fingerprint, 300),
         coalesce(a.data, '{}'::jsonb)
    from jsonb_to_recordset(p_alerts) as a(kind text, severity text, title text, message text, fingerprint text, data jsonb)
  on conflict (business_id, fingerprint) do update
    set last_seen_at = now(),
        resolved_at = null,
        title = excluded.title,
        message = excluded.message,
        data = excluded.data;

  -- Anything no longer present is resolved.
  update public.alerts
     set resolved_at = now()
   where business_id = p_business_id
     and resolved_at is null
     and fingerprint not in (select a.fingerprint from jsonb_to_recordset(p_alerts) as a(fingerprint text));

  return query
    select * from public.alerts
     where business_id = p_business_id and resolved_at is null and dismissed_at is null
     order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, first_seen_at;
end;
$$;

create or replace function public.dismiss_alert(p_business_id uuid, p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  update public.alerts set dismissed_at = now()
   where id = p_alert_id and business_id = p_business_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI assistant: conversations scoped to business AND user.
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null default 'New conversation' check (char_length(title) <= 120),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, id)
);
create index ai_conversations_owner_idx on public.ai_conversations (business_id, user_id, updated_at desc);

create table public.ai_messages (
  id               bigint generated always as identity primary key,
  business_id      uuid not null,
  conversation_id  uuid not null,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null check (char_length(content) <= 8000),
  facts            jsonb not null default '[]'::jsonb,     -- figures the answer is based on
  warnings         jsonb not null default '[]'::jsonb,     -- data gaps, unverified numbers
  proposal         jsonb,                                   -- record the AI suggests creating (needs confirmation)
  created_at       timestamptz not null default now(),
  foreign key (business_id, conversation_id) references public.ai_conversations (business_id, id) on delete cascade
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, id);

create trigger ai_conversations_touch before update on public.ai_conversations
  for each row execute function private.touch_updated_at();

-- Fixed-window rate limit per user for the (paid) AI endpoint. Stored in
-- Postgres so it holds across serverless instances.
create table public.ai_rate_limits (
  user_id       uuid not null references auth.users (id) on delete cascade,
  window_start  timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, window_start)
);

create or replace function public.consume_ai_quota()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_window timestamptz := date_trunc('hour', now());
  v_limit constant integer := 40;   -- requests per user per hour
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  insert into public.ai_rate_limits (user_id, window_start, request_count)
  values (v_uid, v_window, 1)
  on conflict (user_id, window_start) do update set request_count = public.ai_rate_limits.request_count + 1
  returning request_count into v_count;

  delete from public.ai_rate_limits where user_id = v_uid and window_start < v_window - interval '1 day';

  return jsonb_build_object(
    'allowed', v_count <= v_limit,
    'remaining', greatest(v_limit - v_count, 0),
    'reset_at', v_window + interval '1 hour'
  );
end;
$$;
