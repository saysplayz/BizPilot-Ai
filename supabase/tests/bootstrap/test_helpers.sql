-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- =============================================================================
-- Test helpers (installed into a throwaway test database only).
-- Tests run as the superuser, then impersonate Supabase users with
-- tests.login(uid), which switches to the `authenticated` role and sets the
-- JWT `sub` claim exactly like PostgREST does — so RLS is genuinely exercised.
-- =============================================================================

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.create_user(p_email text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
  values (p_email, jsonb_build_object('full_name', split_part(p_email, '@', 1)))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function tests.login(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.login_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

create or replace function tests.assert_eq(p_actual anyelement, p_expected anyelement, p_message text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_message, p_expected, p_actual;
  end if;
end;
$$;

create or replace function tests.assert_true(p_value boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

-- Runs p_sql and asserts it raises an error whose message contains
-- p_fragment (case-insensitive) or whose SQLSTATE equals p_fragment.
create or replace function tests.assert_raises(p_sql text, p_fragment text, p_message text)
returns void
language plpgsql
as $$
declare
  v_msg text;
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    if v_state = p_fragment or position(lower(p_fragment) in lower(v_msg)) > 0 then
      return;
    end if;
    raise exception 'ASSERTION FAILED: % — raised "%" (%) but expected "%"', p_message, v_msg, v_state, p_fragment;
  end;
  raise exception 'ASSERTION FAILED: % — expected an error containing "%" but none was raised', p_message, p_fragment;
end;
$$;

-- Ledger balance for an account, read as superuser (bypasses RLS).
create or replace function tests.balance(p_business_id uuid, p_account public.ledger_account)
returns bigint
language sql
security definer
as $$
  select coalesce(sum(amount_minor), 0)::bigint
    from public.ledger_entries where business_id = p_business_id and account = p_account;
$$;

create or replace function tests.revenue(p_business_id uuid)
returns bigint
language sql
security definer
as $$
  select coalesce(-sum(amount_minor), 0)::bigint
    from public.ledger_entries where business_id = p_business_id and account = 'sales_revenue';
$$;

-- Every transaction in the business balances, and the whole ledger sums to zero.
create or replace function tests.assert_ledger_balanced(p_business_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_bad integer;
  v_total bigint;
begin
  select count(*) into v_bad from (
    select transaction_id from public.ledger_entries where business_id = p_business_id
     group by transaction_id having sum(amount_minor) <> 0) x;
  select coalesce(sum(amount_minor), 0) into v_total from public.ledger_entries where business_id = p_business_id;
  if v_bad > 0 or v_total <> 0 then
    raise exception 'ASSERTION FAILED: ledger unbalanced (% bad transactions, total %)', v_bad, v_total;
  end if;
end;
$$;

grant execute on all functions in schema tests to authenticated, anon;

create or replace function tests.pass(p_name text)
returns void
language plpgsql
as $$
begin
  raise notice 'PASS: %', p_name;
end;
$$;
grant execute on function tests.pass(text) to authenticated, anon;
