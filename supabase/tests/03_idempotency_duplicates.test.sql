-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- Required test 9: duplicate payments or imports cannot silently double-count.
do $$
declare
  u uuid := tests.create_user('idem@example.com');
  biz uuid; cust uuid; sup uuid; prod uuid;
  k uuid := gen_random_uuid();
  r1 jsonb; r2 jsonb; ar_before bigint; cash_before bigint;
begin
  perform tests.login(u);
  biz := public.create_business('Idem Shop', 'clothing', 'GHS', 50000);
  insert into public.customers (business_id, name) values (biz, 'Kwame') returning id into cust;
  insert into public.suppliers (business_id, name) values (biz, 'Fabric Co') returning id into sup;
  insert into public.products (business_id, name, selling_price_minor) values (biz, 'Shirt', 8000) returning id into prod;
  perform public.record_opening_stock(biz, prod, 10, 4000, current_date - 5, gen_random_uuid());

  -- Same sale submitted twice (double tap / network retry) posts once.
  r1 := public.record_sale(biz, 'credit', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 2, 'unit_price_minor', 8000)),
                           current_date, k, p_customer_id => cust);
  r2 := public.record_sale(biz, 'credit', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 2, 'unit_price_minor', 8000)),
                           current_date, k, p_customer_id => cust);
  perform tests.assert_eq(r1->>'transaction_id', r2->>'transaction_id', 'replay returns the same transaction');
  perform tests.assert_eq((r2->>'replayed')::boolean, true, 'replay is flagged');
  perform tests.assert_eq((select quantity_on_hand from public.products where id = prod), 8, 'stock reduced only once');
  perform tests.assert_eq(tests.revenue(biz), 16000::bigint, 'revenue counted once');
  perform tests.pass('retried sale with the same idempotency key posts once (stock and revenue counted once)');

  -- Same payment submitted twice posts once.
  k := gen_random_uuid();
  ar_before := tests.balance(biz, 'accounts_receivable');
  cash_before := tests.balance(biz, 'cash');
  perform public.record_customer_payment(biz, cust, 10000, current_date, k);
  perform public.record_customer_payment(biz, cust, 10000, current_date, k);
  perform tests.assert_eq(tests.balance(biz, 'accounts_receivable'), ar_before - 10000, 'receivable reduced once');
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before + 10000, 'cash increased once');
  perform tests.assert_eq((select count(*)::int from public.payments where business_id = biz), 1, 'one payment row');
  perform tests.pass('retried customer payment posts once');

  -- Overpayment is rejected rather than creating phantom money.
  perform tests.assert_raises(format('select public.record_customer_payment(%L, %L, 999999, current_date, gen_random_uuid())', biz, cust),
    'more than', 'cannot collect more than is owed');
  perform tests.pass('a payment larger than the outstanding balance is rejected');

  -- Reusing a key for a different kind of record is refused.
  perform tests.assert_raises(format('select public.record_expense(%L, ''Transport'', 100, current_date, ''x'', %L)', biz, k),
    'different kind', 'key reuse across record types rejected');
  perform tests.pass('an idempotency key cannot be reused for a different kind of record');

  -- Bill replay posts once.
  k := gen_random_uuid();
  perform public.create_bill(biz, sup, 'expense', jsonb_build_array(jsonb_build_object('description', 'Rent', 'quantity', 1, 'unit_cost_minor', 30000)),
                             current_date, current_date + 7, k, p_category => 'Rent');
  perform public.create_bill(biz, sup, 'expense', jsonb_build_array(jsonb_build_object('description', 'Rent', 'quantity', 1, 'unit_cost_minor', 30000)),
                             current_date, current_date + 7, k, p_category => 'Rent');
  perform tests.assert_eq((select count(*)::int from public.bills where business_id = biz), 1, 'one bill');
  perform tests.assert_eq(tests.balance(biz, 'accounts_payable'), -30000::bigint, 'payable counted once');
  perform tests.pass('retried bill creation posts once');

  -- Imports: the same row fingerprint cannot be posted twice.
  perform public.record_expense(biz, 'Utilities', 4500, current_date - 3, 'ECG units', gen_random_uuid(),
                                p_source => 'import', p_import_fingerprint => 'row:2026-10-25|4500|ecg units');
  perform tests.assert_raises(format(
    'select public.record_expense(%L, ''Utilities'', 4500, current_date - 3, ''ECG units'', gen_random_uuid(), p_source => ''import'', p_import_fingerprint => ''row:2026-10-25|4500|ecg units'')', biz),
    '23505', 'duplicate import row rejected by unique fingerprint');
  perform tests.pass('duplicate CSV import rows are blocked by a unique fingerprint');

  perform tests.logout();
  perform tests.assert_ledger_balanced(biz);
end;
$$;
