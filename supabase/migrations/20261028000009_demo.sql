-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0009 Hackathon demo business
--
-- create_demo_business() builds a clearly labelled FICTIONAL electronics shop
-- for the signed-in user, using the same posting functions as real data so
-- the ledger, stock and documents are fully consistent. Calling it again
-- replaces the user's previous demo business. Demo businesses carry
-- is_demo = true and are never mixed with a real business's records.
--
-- Story (dates relative to today, D):
--   cash available today            GH₵3,000  (Cash + Mobile Money)
--   rent due D+3                    GH₵1,000  (planned payment)
--   supplier bill due D+5           GH₵1,500  (Accra Gadget Wholesale)
--   Ama Mensah pays D+10            GH₵2,000  (expected collection)
--   Yaw Boateng owes                GH₵450    (overdue → uncertain, excluded)
--   proposed stock purchase         GH₵2,000  (saved what-if scenarios)
-- Baseline never drops below GH₵500. Buying stock tomorrow creates a
-- shortfall from D+5 until Ama pays — the timing problem the demo explains.
-- =============================================================================

-- Erase a business and everything it owns, children first. Business-scoped
-- foreign keys are deliberately NOT cascading (a stray delete must never
-- silently remove ledger history), so erasure is explicit and ordered.
-- Used for demo resets; also the basis for account-deletion requests.
create or replace function private.erase_business(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.ai_messages where business_id = p_business_id;
  delete from public.ai_conversations where business_id = p_business_id;
  delete from public.alerts where business_id = p_business_id;
  delete from public.cashflow_scenario_events where business_id = p_business_id;
  delete from public.cashflow_scenarios where business_id = p_business_id;
  delete from public.scheduled_event_settlements where business_id = p_business_id;
  delete from public.scheduled_cash_events where business_id = p_business_id;
  delete from public.payment_allocations where business_id = p_business_id;
  delete from public.payments where business_id = p_business_id;
  delete from public.invoice_lines where business_id = p_business_id;
  delete from public.invoices where business_id = p_business_id;
  delete from public.bill_lines where business_id = p_business_id;
  delete from public.bills where business_id = p_business_id;
  delete from public.inventory_movements where business_id = p_business_id;
  delete from public.ledger_entries where business_id = p_business_id;
  delete from public.transactions where business_id = p_business_id;
  delete from public.loans where business_id = p_business_id;
  delete from public.products where business_id = p_business_id;
  delete from public.customers where business_id = p_business_id;
  delete from public.suppliers where business_id = p_business_id;
  delete from public.financial_accounts where business_id = p_business_id;
  delete from public.businesses where id = p_business_id;  -- cascades memberships, counters, audit
end;
$$;

create or replace function public.create_demo_business()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  d date := current_date;
  v_biz uuid;
  v_cash uuid;
  v_momo uuid;
  s_gadget uuid; s_access uuid;
  c_ama uuid; c_yaw uuid; c_efua uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid;
  v_ama_invoice uuid;
  v_net bigint;
  v_res jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Replace any previous demo business owned by this user.
  perform private.erase_business(b.id)
     from public.businesses b
    where b.is_demo and b.created_by = v_uid
      and exists (select 1 from public.business_memberships m
                   where m.business_id = b.id and m.user_id = v_uid and m.role = 'owner');

  v_biz := public.create_business('Kofi''s Phone Hub (Demo)', 'electronics', 'GHS', null, 50000);
  update public.businesses set is_demo = true where id = v_biz;
  select id into v_cash from public.financial_accounts where business_id = v_biz and kind = 'cash';
  select id into v_momo from public.financial_accounts where business_id = v_biz and kind = 'mobile_money';

  insert into public.suppliers (business_id, name, phone, payment_terms_days, notes)
  values (v_biz, 'Accra Gadget Wholesale', '+233 30 255 0100', 14, 'Fictional demo supplier')
  returning id into s_gadget;
  insert into public.suppliers (business_id, name, phone, payment_terms_days, notes)
  values (v_biz, 'Kumasi Accessories Ltd', '+233 32 200 0200', 7, 'Fictional demo supplier')
  returning id into s_access;

  insert into public.customers (business_id, name, phone, payment_terms_days, credit_limit_minor, notes)
  values (v_biz, 'Ama Mensah', '+233 24 555 0101', 14, 300000, 'Fictional demo customer')
  returning id into c_ama;
  insert into public.customers (business_id, name, phone, payment_terms_days, notes)
  values (v_biz, 'Yaw Boateng', '+233 20 555 0102', 7, 'Fictional demo customer')
  returning id into c_yaw;
  insert into public.customers (business_id, name, notes)
  values (v_biz, 'Efua Asante', 'Fictional demo customer')
  returning id into c_efua;

  insert into public.products (business_id, name, sku, selling_price_minor, last_unit_cost_minor, low_stock_threshold, supplier_id)
  values (v_biz, 'Android Phone 128GB', 'PH-128', 145000, 110000, 3, s_gadget) returning id into p1;
  insert into public.products (business_id, name, sku, selling_price_minor, last_unit_cost_minor, low_stock_threshold, supplier_id)
  values (v_biz, 'Android Phone 256GB', 'PH-256', 230000, 185000, 3, s_gadget) returning id into p2;
  insert into public.products (business_id, name, sku, selling_price_minor, last_unit_cost_minor, low_stock_threshold, supplier_id)
  values (v_biz, 'Fast Charger 25W', 'CH-25', 6000, 3000, 10, s_access) returning id into p3;
  insert into public.products (business_id, name, sku, selling_price_minor, last_unit_cost_minor, low_stock_threshold, supplier_id)
  values (v_biz, 'Wireless Earbuds', 'EB-01', 15000, 8000, 5, s_gadget) returning id into p4;
  insert into public.products (business_id, name, sku, selling_price_minor, last_unit_cost_minor, low_stock_threshold, supplier_id)
  values (v_biz, 'Power Bank 20,000mAh', 'PB-20', 22000, 14000, 5, s_access) returning id into p5;
  insert into public.products (business_id, name, sku, selling_price_minor, last_unit_cost_minor, low_stock_threshold, supplier_id)
  values (v_biz, 'Screen Protector', 'SP-01', 2500, 800, 15, s_access) returning id into p6;
  insert into public.products (business_id, name, sku, selling_price_minor, last_unit_cost_minor, low_stock_threshold, supplier_id)
  values (v_biz, 'Phone Case', 'PC-01', 4500, 1800, 10, s_access) returning id into p7;

  -- Opening stock (D-45).
  perform public.record_opening_stock(v_biz, p1, 8, 110000, d - 45, gen_random_uuid());
  perform public.record_opening_stock(v_biz, p2, 5, 185000, d - 45, gen_random_uuid());
  perform public.record_opening_stock(v_biz, p3, 40, 3000, d - 45, gen_random_uuid());
  perform public.record_opening_stock(v_biz, p4, 15, 8000, d - 45, gen_random_uuid());
  perform public.record_opening_stock(v_biz, p5, 6, 14000, d - 45, gen_random_uuid());
  perform public.record_opening_stock(v_biz, p6, 60, 800, d - 45, gen_random_uuid());
  perform public.record_opening_stock(v_biz, p7, 30, 1800, d - 45, gen_random_uuid());

  -- Trading history.
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity', 1, 'unit_price_minor', 145000),
    jsonb_build_object('product_id', p6, 'quantity', 2, 'unit_price_minor', 2500)), d - 40, gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p3, 'quantity', 3, 'unit_price_minor', 6000),
    jsonb_build_object('product_id', p7, 'quantity', 2, 'unit_price_minor', 4500)), d - 38, gen_random_uuid(),
    p_payment_method => 'mobile_money', p_source => 'demo');
  perform public.record_expense(v_biz, 'Transport', 8000, d - 35, 'Trotro and taxi to wholesaler', gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p2, 'quantity', 1, 'unit_price_minor', 230000)), d - 33, gen_random_uuid(),
    p_customer_id => c_efua, p_payment_method => 'mobile_money', p_source => 'demo');
  perform public.record_expense(v_biz, 'Wages', 80000, d - 31, 'Shop assistant wage', gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_stock_purchase(v_biz, jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity', 2, 'unit_cost_minor', 110000)), d - 30, gen_random_uuid(),
    p_supplier_id => s_gadget, p_payment_method => 'cash', p_source => 'demo');
  perform public.record_owner_transaction(v_biz, 'out', 200000, d - 29, gen_random_uuid(),
    p_payment_method => 'cash', p_description => 'Owner drawings');
  perform public.record_expense(v_biz, 'Rent', 100000, d - 28, 'Shop rent (last month)', gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_expense(v_biz, 'Utilities', 15000, d - 27, 'Electricity prepaid units', gen_random_uuid(),
    p_payment_method => 'mobile_money', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity', 2, 'unit_price_minor', 145000),
    jsonb_build_object('product_id', p3, 'quantity', 2, 'unit_price_minor', 6000)), d - 25, gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_stock_purchase(v_biz, jsonb_build_array(
    jsonb_build_object('product_id', p6, 'quantity', 40, 'unit_cost_minor', 800),
    jsonb_build_object('product_id', p7, 'quantity', 20, 'unit_cost_minor', 1800)), d - 22, gen_random_uuid(),
    p_supplier_id => s_access, p_payment_method => 'cash', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p4, 'quantity', 3, 'unit_price_minor', 15000)), d - 20, gen_random_uuid(),
    p_payment_method => 'mobile_money', p_source => 'demo');
  perform public.record_expense(v_biz, 'Internet & phone', 10000, d - 18, 'Mobile data bundle', gen_random_uuid(),
    p_payment_method => 'mobile_money', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p5, 'quantity', 2, 'unit_price_minor', 22000),
    jsonb_build_object('product_id', p6, 'quantity', 5, 'unit_price_minor', 2500)), d - 15, gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_owner_transaction(v_biz, 'out', 250000, d - 14, gen_random_uuid(),
    p_payment_method => 'cash', p_description => 'Owner drawings (school fees)');
  perform public.record_sale(v_biz, 'credit', jsonb_build_array(
    jsonb_build_object('product_id', p4, 'quantity', 2, 'unit_price_minor', 15000),
    jsonb_build_object('product_id', p5, 'quantity', 1, 'unit_price_minor', 22000)), d - 13, gen_random_uuid(),
    p_customer_id => c_yaw, p_due_date => d - 6, p_source => 'demo');
  perform public.create_bill(v_biz, s_gadget, 'inventory', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity', 1, 'unit_cost_minor', 110000),
    jsonb_build_object('product_id', p4, 'quantity', 5, 'unit_cost_minor', 8000)), d - 9, d + 5, gen_random_uuid(),
    p_post => true, p_supplier_reference => 'AGW-4471', p_source => 'demo');
  perform public.record_customer_payment(v_biz, c_yaw, 7000, d - 9, gen_random_uuid(),
    p_payment_method => 'mobile_money', p_source => 'demo');
  perform public.record_owner_transaction(v_biz, 'out', 150000, d - 10, gen_random_uuid(),
    p_payment_method => 'cash', p_description => 'Owner drawings');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p2, 'quantity', 1, 'unit_price_minor', 230000)), d - 8, gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_transfer(v_biz, v_momo, v_cash, 250000, d - 7, gen_random_uuid(), 'Cashed out Mobile Money for the till');
  perform public.record_expense(v_biz, 'Transport', 6000, d - 6, 'Delivery to customer', gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_expense(v_biz, 'Security & cleaning', 10000, d - 5, 'Market security levy', gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  v_res := public.record_sale(v_biz, 'credit', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity', 1, 'unit_price_minor', 145000),
    jsonb_build_object('product_id', p5, 'quantity', 1, 'unit_price_minor', 22000),
    jsonb_build_object('product_id', p4, 'quantity', 1, 'unit_price_minor', 15000),
    jsonb_build_object('product_id', p3, 'quantity', 3, 'unit_price_minor', 6000)), d - 4, gen_random_uuid(),
    p_customer_id => c_ama, p_due_date => d + 10, p_source => 'demo');
  v_ama_invoice := (v_res ->> 'invoice_id')::uuid;
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p3, 'quantity', 4, 'unit_price_minor', 6000),
    jsonb_build_object('product_id', p7, 'quantity', 3, 'unit_price_minor', 4500)), d - 3, gen_random_uuid(),
    p_payment_method => 'mobile_money', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity', 1, 'unit_price_minor', 145000)), d - 2, gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p6, 'quantity', 6, 'unit_price_minor', 2500),
    jsonb_build_object('product_id', p4, 'quantity', 1, 'unit_price_minor', 15000)), d - 1, gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_expense(v_biz, 'Transport', 5000, d - 1, 'Taxi to Circle market', gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');
  perform public.record_sale(v_biz, 'cash', jsonb_build_array(
    jsonb_build_object('product_id', p3, 'quantity', 2, 'unit_price_minor', 6000)), d, gen_random_uuid(),
    p_payment_method => 'cash', p_source => 'demo');

  -- Opening cash chosen so that cash available today is exactly GH₵3,000.
  select coalesce(sum(amount_minor), 0) into v_net
    from public.ledger_entries where business_id = v_biz and account = 'cash';
  perform public.record_opening_balance(v_biz, v_cash, 300000 - v_net, d - 45, gen_random_uuid());

  -- Planned rent (monthly) — forecast-only until paid.
  insert into public.scheduled_cash_events (business_id, direction, label, category, amount_minor, start_date, recurrence, confidence, created_by)
  values (v_biz, 'out', 'Shop rent', 'Rent', 100000, d + 3, 'monthly', 'scheduled', v_uid);

  -- Saved what-if scenarios for the presenter (offsets keep them valid on any day).
  perform public.save_cashflow_scenario(v_biz, 'Buy GH₵2,000 stock tomorrow',
    'Restock phones immediately, before Ama pays.', 30,
    jsonb_build_array(jsonb_build_object('kind', 'one_off', 'direction', 'out', 'amount_minor', 200000,
      'day_offset', 1, 'label', 'Proposed stock purchase', 'category', 'Stock purchases')));
  perform public.save_cashflow_scenario(v_biz, 'Buy stock tomorrow + collect from Ama early',
    'Restock now, and ask Ama to pay on day 4 instead of day 10.', 30,
    jsonb_build_array(
      jsonb_build_object('kind', 'one_off', 'direction', 'out', 'amount_minor', 200000,
        'day_offset', 1, 'label', 'Proposed stock purchase', 'category', 'Stock purchases'),
      jsonb_build_object('kind', 'collect_early', 'invoice_id', v_ama_invoice, 'day_offset', 4)));
  perform public.save_cashflow_scenario(v_biz, 'Buy stock after Ama pays',
    'Wait until the GH₵2,000 from Ama arrives, then restock.', 30,
    jsonb_build_array(jsonb_build_object('kind', 'one_off', 'direction', 'out', 'amount_minor', 200000,
      'day_offset', 10, 'label', 'Proposed stock purchase', 'category', 'Stock purchases')));

  perform private.audit(v_biz, 'create', 'demo_business', v_biz, jsonb_build_object('note', 'Fictional demo data'));
  return v_biz;
end;
$$;

revoke all on function private.erase_business(uuid) from public, anon, authenticated;
revoke execute on function public.create_demo_business() from public, anon;
grant execute on function public.create_demo_business() to authenticated;
