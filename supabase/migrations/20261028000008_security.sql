-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0008 Row Level Security and privileges
--
-- Model
--   * anon: no access to any business data.
--   * authenticated: may READ rows of businesses they are a member of.
--     May WRITE master data (customers, suppliers, products, planned events)
--     directly, constrained by RLS and column privileges.
--     May NOT write ledger/document tables directly; financial writes go
--     through the SECURITY DEFINER posting functions, which check membership
--     and keep everything balanced.
--   * Cross-tenant references are also blocked structurally: every foreign
--     key between business-owned tables includes business_id.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Start from zero: remove the broad default grants Supabase gives new tables.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant usage on schema public to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.business_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere (default deny).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'businesses', 'business_memberships', 'audit_events',
    'financial_accounts', 'customers', 'suppliers', 'products', 'loans', 'document_counters',
    'transactions', 'ledger_entries', 'inventory_movements', 'invoices', 'invoice_lines',
    'bills', 'bill_lines', 'payments', 'payment_allocations',
    'scheduled_cash_events', 'scheduled_event_settlements',
    'cashflow_scenarios', 'cashflow_scenario_events', 'alerts',
    'ai_conversations', 'ai_messages', 'ai_rate_limits'
  ] loop
    -- Not FORCEd: SECURITY DEFINER posting functions run as the table owner
    -- and must bypass RLS after doing their own membership checks.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: a user sees and edits only their own profile.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Businesses and memberships
-- ---------------------------------------------------------------------------
grant select on public.businesses to authenticated;
grant update (name, business_type, min_cash_reserve_minor) on public.businesses to authenticated;
create policy businesses_select_member on public.businesses for select to authenticated
  using (private.is_member(id));
create policy businesses_update_admin on public.businesses for update to authenticated
  using (private.has_role(id, array['owner','manager']::public.business_role[]))
  with check (private.has_role(id, array['owner','manager']::public.business_role[]));

grant select on public.business_memberships to authenticated;
create policy memberships_select_member on public.business_memberships for select to authenticated
  using (private.is_member(business_id));

grant select on public.audit_events to authenticated;
create policy audit_select_admin on public.audit_events for select to authenticated
  using (private.has_role(business_id, array['owner','manager']::public.business_role[]));

-- ---------------------------------------------------------------------------
-- Read-only financial tables (writes only via posting functions)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'loans', 'transactions', 'ledger_entries', 'inventory_movements', 'invoices', 'invoice_lines',
    'bills', 'bill_lines', 'payments', 'payment_allocations', 'scheduled_event_settlements',
    'cashflow_scenario_events', 'alerts'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_member(business_id))',
      t || '_select_member', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Master data writable by members (RLS + column privileges)
-- ---------------------------------------------------------------------------
grant select on public.financial_accounts to authenticated;
grant insert (business_id, name, kind) on public.financial_accounts to authenticated;
grant update (name, archived_at) on public.financial_accounts to authenticated;
create policy financial_accounts_select on public.financial_accounts for select to authenticated
  using (private.is_member(business_id));
create policy financial_accounts_insert on public.financial_accounts for insert to authenticated
  with check (private.has_role(business_id, array['owner','manager']::public.business_role[]));
create policy financial_accounts_update on public.financial_accounts for update to authenticated
  using (private.has_role(business_id, array['owner','manager']::public.business_role[]))
  with check (private.has_role(business_id, array['owner','manager']::public.business_role[]));

grant select on public.customers to authenticated;
grant insert (business_id, name, phone, notes, credit_limit_minor, payment_terms_days) on public.customers to authenticated;
grant update (name, phone, notes, credit_limit_minor, payment_terms_days, archived_at) on public.customers to authenticated;
create policy customers_select on public.customers for select to authenticated using (private.is_member(business_id));
create policy customers_insert on public.customers for insert to authenticated with check (private.is_member(business_id));
create policy customers_update on public.customers for update to authenticated
  using (private.is_member(business_id)) with check (private.is_member(business_id));

grant select on public.suppliers to authenticated;
grant insert (business_id, name, phone, email, notes, payment_terms_days) on public.suppliers to authenticated;
grant update (name, phone, email, notes, payment_terms_days, archived_at) on public.suppliers to authenticated;
create policy suppliers_select on public.suppliers for select to authenticated using (private.is_member(business_id));
create policy suppliers_insert on public.suppliers for insert to authenticated with check (private.is_member(business_id));
create policy suppliers_update on public.suppliers for update to authenticated
  using (private.is_member(business_id)) with check (private.is_member(business_id));

-- quantity_on_hand and inventory_value_minor are intentionally NOT grantable:
-- they change only through stock movements.
grant select on public.products to authenticated;
grant insert (business_id, name, sku, description, selling_price_minor, last_unit_cost_minor,
              low_stock_threshold, supplier_id, barcode, expiry_date) on public.products to authenticated;
grant update (name, sku, description, selling_price_minor, last_unit_cost_minor,
              low_stock_threshold, supplier_id, barcode, expiry_date, archived_at) on public.products to authenticated;
create policy products_select on public.products for select to authenticated using (private.is_member(business_id));
create policy products_insert on public.products for insert to authenticated with check (private.is_member(business_id));
create policy products_update on public.products for update to authenticated
  using (private.is_member(business_id)) with check (private.is_member(business_id));

grant select, delete on public.scheduled_cash_events to authenticated;
grant insert (business_id, direction, label, category, amount_minor, start_date, recurrence, end_date, confidence)
  on public.scheduled_cash_events to authenticated;
grant update (label, category, amount_minor, start_date, recurrence, end_date, confidence, active)
  on public.scheduled_cash_events to authenticated;
create policy scheduled_select on public.scheduled_cash_events for select to authenticated using (private.is_member(business_id));
create policy scheduled_insert on public.scheduled_cash_events for insert to authenticated with check (private.is_member(business_id));
create policy scheduled_update on public.scheduled_cash_events for update to authenticated
  using (private.is_member(business_id)) with check (private.is_member(business_id));
create policy scheduled_delete on public.scheduled_cash_events for delete to authenticated
  using (private.has_role(business_id, array['owner','manager']::public.business_role[]));

grant select, delete on public.cashflow_scenarios to authenticated;
create policy scenarios_select on public.cashflow_scenarios for select to authenticated using (private.is_member(business_id));
create policy scenarios_delete on public.cashflow_scenarios for delete to authenticated using (private.is_member(business_id));

-- ---------------------------------------------------------------------------
-- AI conversations: private to the user AND scoped to a business they belong to.
-- ---------------------------------------------------------------------------
grant select, delete on public.ai_conversations to authenticated;
grant insert (business_id, user_id, title) on public.ai_conversations to authenticated;
grant update (title) on public.ai_conversations to authenticated;
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (user_id = auth.uid() and private.is_member(business_id));
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated
  with check (user_id = auth.uid() and private.is_member(business_id));
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (user_id = auth.uid() and private.is_member(business_id))
  with check (user_id = auth.uid() and private.is_member(business_id));
create policy ai_conversations_delete on public.ai_conversations for delete to authenticated
  using (user_id = auth.uid() and private.is_member(business_id));

grant select on public.ai_messages to authenticated;
grant insert (business_id, conversation_id, user_id, role, content, facts, warnings, proposal) on public.ai_messages to authenticated;
create policy ai_messages_select on public.ai_messages for select to authenticated
  using (user_id = auth.uid() and private.is_member(business_id));
create policy ai_messages_insert on public.ai_messages for insert to authenticated
  with check (
    user_id = auth.uid() and private.is_member(business_id)
    and exists (select 1 from public.ai_conversations c
                 where c.id = conversation_id and c.business_id = ai_messages.business_id and c.user_id = auth.uid())
  );

-- document_counters and ai_rate_limits: no direct access at all.

-- ---------------------------------------------------------------------------
-- RPCs callable by signed-in users. Each function checks membership itself.
-- ---------------------------------------------------------------------------
grant execute on all functions in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
