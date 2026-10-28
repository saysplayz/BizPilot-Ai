-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- Voiding by reversal, audit trail, roles.
do $$
declare
  u uuid := tests.create_user('void@example.com');
  staff uuid := tests.create_user('staff@example.com');
  biz uuid; cust uuid; sup uuid; prod uuid;
  r jsonb; sale_txn uuid; pay_txn uuid; bill_txn uuid; v jsonb;
  cash0 bigint; rev0 bigint; inv0 bigint; qty0 int;
begin
  perform tests.login(u);
  biz := public.create_business('Void Shop', 'electronics', 'GHS', 200000);
  insert into public.customers (business_id, name) values (biz, 'Esi') returning id into cust;
  insert into public.suppliers (business_id, name) values (biz, 'Sup') returning id into sup;
  insert into public.products (business_id, name, selling_price_minor) values (biz, 'Cable', 2000) returning id into prod;
  perform public.record_opening_stock(biz, prod, 10, 1000, current_date - 9, gen_random_uuid());

  cash0 := tests.balance(biz, 'cash'); rev0 := tests.revenue(biz); inv0 := tests.balance(biz, 'inventory');
  qty0 := (select quantity_on_hand from public.products where id = prod);

  -- Credit sale + payment; voiding the sale is blocked until the payment is voided.
  r := public.record_sale(biz, 'credit', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 3, 'unit_price_minor', 2000)),
                          current_date - 2, gen_random_uuid(), p_customer_id => cust);
  sale_txn := (r->>'transaction_id')::uuid;
  pay_txn := (public.record_customer_payment(biz, cust, 2000, current_date - 1, gen_random_uuid())->>'transaction_id')::uuid;
  perform tests.assert_raises(format('select public.void_transaction(%L, %L, ''mistake'', gen_random_uuid())', biz, sale_txn),
    'payments', 'cannot void a sale with live payments');
  perform tests.pass('a sale with payments cannot be voided until its payments are voided');

  v := public.void_transaction(biz, pay_txn, 'Entered twice', gen_random_uuid());
  perform tests.assert_eq((select status::text from public.invoices where id = (r->>'invoice_id')::uuid), 'open', 'invoice reopened');
  perform public.void_transaction(biz, sale_txn, 'Wrong customer', gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash0, 'cash restored');
  perform tests.assert_eq(tests.revenue(biz), rev0, 'revenue restored');
  perform tests.assert_eq(tests.balance(biz, 'accounts_receivable'), 0::bigint, 'receivable cleared');
  perform tests.assert_eq(tests.balance(biz, 'inventory'), inv0, 'inventory value restored exactly');
  perform tests.assert_eq((select quantity_on_hand from public.products where id = prod), qty0, 'stock restored');
  perform tests.assert_eq((select status::text from public.transactions where id = sale_txn), 'voided', 'original kept and marked voided');
  perform tests.assert_true(exists (select 1 from public.transactions where reversal_of = sale_txn and type = 'void_reversal'), 'reversal posted');
  perform tests.assert_eq((select status::text from public.invoices where id = (r->>'invoice_id')::uuid), 'void', 'invoice voided');
  perform tests.pass('voiding posts an exact reversal: cash, revenue, receivables, stock and value return to their prior state');

  -- Void is idempotent; a second void with a different key is refused.
  perform tests.assert_raises(format('select public.void_transaction(%L, %L, ''again'', gen_random_uuid())', biz, sale_txn),
    'already voided', 'double void refused');
  perform tests.assert_raises(format('select public.void_transaction(%L, (select reversed_by from public.transactions where id = %L), ''x'', gen_random_uuid())', biz, sale_txn),
    'cannot be voided', 'reversals cannot be voided');
  perform tests.pass('a record can only be voided once and reversals cannot be voided');

  -- Voiding a stock bill removes the stock; blocked once that stock is sold.
  bill_txn := (public.create_bill(biz, sup, 'inventory', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 5, 'unit_cost_minor', 1200)),
                                  current_date - 1, current_date + 7, gen_random_uuid())->>'transaction_id')::uuid;
  perform public.record_sale(biz, 'cash', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 14, 'unit_price_minor', 2000)),
                             current_date, gen_random_uuid());
  perform tests.assert_raises(format('select public.void_transaction(%L, %L, ''x'', gen_random_uuid())', biz, bill_txn),
    'already sold', 'cannot void a purchase whose stock is gone');
  perform tests.pass('a stock purchase cannot be voided after its stock has been sold');

  -- Edit details is audited; amounts cannot be edited.
  perform public.update_transaction_details(biz, pay_txn, 'Payment from Esi (corrected)', 'MOMO-123', 'checked statement');
  perform tests.assert_true(exists (select 1 from public.audit_events where entity_id = pay_txn and action = 'edit_details'),
                            'detail edit audited with before/after');
  perform tests.assert_raises(format('update public.transactions set amount_minor = 1 where id = %L', pay_txn), '42501',
                              'amounts cannot be edited directly');
  perform tests.pass('only descriptive fields can be edited, and edits are audited');

  -- Audit trail covers postings, voids and master-data changes.
  perform tests.assert_true(exists (select 1 from public.audit_events where business_id = biz and action = 'void' and entity_id = sale_txn), 'void audited');
  perform tests.assert_true(exists (select 1 from public.audit_events where business_id = biz and action = 'post'), 'postings audited');
  update public.customers set phone = '+233 24 111 2222' where id = cust;
  perform tests.assert_true(exists (select 1 from public.audit_events where business_id = biz and entity_type = 'customers' and action = 'update'), 'master data edit audited');
  perform tests.assert_raises('delete from public.audit_events', '42501', 'audit log cannot be deleted');
  perform tests.pass('postings, voids and master-data edits are written to an append-only audit log');
  perform tests.logout();

  -- Roles: staff can record sales but cannot void.
  insert into public.business_memberships (business_id, user_id, role) values (biz, staff, 'staff');
  perform tests.login(staff);
  perform public.record_expense(biz, 'Transport', 500, current_date, 'Taxi', gen_random_uuid());
  perform tests.assert_raises(format('select public.void_transaction(%L, %L, ''x'', gen_random_uuid())', biz, bill_txn),
    '42501', 'staff cannot void');
  perform tests.assert_eq((select count(*)::int from public.audit_events where business_id = biz), 0, 'staff cannot read the audit log');
  perform tests.logout();
  perform tests.pass('staff can record day-to-day activity but cannot void records or read the audit log');

  perform tests.assert_ledger_balanced(biz);
  perform tests.assert_true(not exists (select 1 from public.check_inventory_integrity(biz)), 'inventory consistent after voids');
  perform tests.pass('ledger and inventory remain consistent after voids');
end;
$$;
