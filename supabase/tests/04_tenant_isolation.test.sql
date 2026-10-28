-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- Required test 12: one business cannot access another business's records.
do $$
declare
  alice uuid := tests.create_user('alice@example.com');
  bob uuid := tests.create_user('bob@example.com');
  biz_a uuid; biz_b uuid; cust_a uuid; prod_a uuid; sup_b uuid; txn_a uuid;
  n int;
begin
  perform tests.login(alice);
  biz_a := public.create_business('Alice Cosmetics', 'cosmetics', 'GHS', 100000);
  insert into public.customers (business_id, name, phone) values (biz_a, 'Secret Customer', '+233 24 000 0000') returning id into cust_a;
  insert into public.products (business_id, name, selling_price_minor) values (biz_a, 'Shea butter', 2000) returning id into prod_a;
  txn_a := (public.record_expense(biz_a, 'Rent', 50000, current_date, 'Rent', gen_random_uuid())->>'transaction_id')::uuid;
  perform tests.logout();

  perform tests.login(bob);
  biz_b := public.create_business('Bob Electronics', 'electronics', 'GHS', 10000);
  insert into public.suppliers (business_id, name) values (biz_b, 'Bob Supplier') returning id into sup_b;

  -- Reads: Bob sees none of Alice's rows through any table or read function.
  select count(*) into n from public.businesses where id = biz_a;
  perform tests.assert_eq(n, 0, 'business hidden');
  select count(*) into n from public.customers where business_id = biz_a;
  perform tests.assert_eq(n, 0, 'customers hidden');
  select count(*) into n from public.transactions where business_id = biz_a;
  perform tests.assert_eq(n, 0, 'transactions hidden');
  select count(*) into n from public.ledger_entries where business_id = biz_a;
  perform tests.assert_eq(n, 0, 'ledger hidden');
  select count(*) into n from public.audit_events where business_id = biz_a;
  perform tests.assert_eq(n, 0, 'audit hidden');
  select count(*) into n from public.get_account_balances(biz_a);
  perform tests.assert_eq(n, 0, 'read function returns nothing for a foreign business');
  perform tests.assert_eq((public.get_forecast_inputs(biz_a)->>'cash_balance_minor')::bigint, 0::bigint,
                          'forecast inputs expose no foreign cash');
  perform tests.assert_eq(jsonb_array_length(public.get_forecast_inputs(biz_a)->'open_invoices'), 0, 'no foreign invoices');
  perform tests.pass('12a. a user cannot read another business''s data (tables and read functions)');

  -- Writes through RPCs are refused.
  perform tests.assert_raises(format('select public.record_expense(%L, ''Rent'', 100, current_date, ''x'', gen_random_uuid())', biz_a),
    '42501', 'cannot post into a foreign business');
  perform tests.assert_raises(format('select public.void_transaction(%L, %L, ''sabotage'', gen_random_uuid())', biz_a, txn_a),
    '42501', 'cannot void a foreign transaction');
  perform tests.assert_raises(format('select public.record_customer_payment(%L, %L, 100, current_date, gen_random_uuid())', biz_a, cust_a),
    '42501', 'cannot record payments for a foreign customer');
  -- Using a foreign customer inside your own business is also refused.
  perform tests.assert_raises(format(
    'select public.record_sale(%L, ''credit'', ''[{"description":"x","quantity":1,"unit_price_minor":100}]''::jsonb, current_date, gen_random_uuid(), p_customer_id => %L)',
    biz_b, cust_a), 'Customer not found', 'cannot reference a foreign customer from own business');
  perform tests.pass('12b. RPC writes into or referencing another business are refused');

  -- Direct table writes are refused by RLS / privileges / composite FKs.
  perform tests.assert_raises(format('insert into public.customers (business_id, name) values (%L, ''Injected'')', biz_a),
    'row-level security', 'cannot insert a customer into a foreign business');
  update public.customers set name = 'Hacked' where id = cust_a;
  get diagnostics n = row_count;
  perform tests.assert_eq(n, 0, 'update of foreign row affects nothing');
  perform tests.assert_raises(format('insert into public.products (business_id, name, supplier_id) values (%L, ''x'', %L)', biz_a, sup_b),
    'row-level security', 'cannot insert product into foreign business');
  perform tests.assert_raises(format('insert into public.transactions (business_id, type, txn_date, description, amount_minor, idempotency_key) values (%L, ''cash_sale'', current_date, ''fake'', 1, gen_random_uuid())', biz_b),
    '42501', 'clients cannot write transactions directly, even in their own business');
  perform tests.assert_raises(format('delete from public.ledger_entries where business_id = %L', biz_b),
    '42501', 'clients cannot delete ledger entries');
  perform tests.pass('12c. direct table writes across tenants (and to the ledger) are blocked');

  -- Self-escalation: Bob cannot add himself to Alice's business.
  perform tests.assert_raises(format('insert into public.business_memberships (business_id, user_id, role) values (%L, %L, ''owner'')', biz_a, bob),
    '42501', 'cannot grant self membership');
  perform tests.assert_raises(format('select private.erase_business(%L)', biz_a), '42501', 'private helpers are not callable');
  perform tests.assert_raises(format('select private.stock_out(%L, %L, 1, gen_random_uuid(), current_date, ''sale'')', biz_a, prod_a),
    '42501', 'internal posting helpers are not callable');
  perform tests.pass('12d. users cannot add themselves to another business or call internal helpers');
  perform tests.logout();

  -- Anonymous visitors see nothing and can call nothing.
  perform tests.login_anon();
  perform tests.assert_raises('select count(*) from public.businesses', '42501', 'anon has no table access');
  perform tests.assert_raises(format('select public.get_forecast_inputs(%L)', biz_a), '42501', 'anon cannot call RPCs');
  perform tests.assert_raises('select public.create_demo_business()', '42501', 'anon cannot create demo data');
  perform tests.logout();
  perform tests.pass('12e. anonymous users have no access to business data or RPCs');

  -- Alice still sees her own data intact.
  perform tests.login(alice);
  perform tests.assert_eq((select name from public.customers where id = cust_a), 'Secret Customer', 'owner data untouched');
  perform tests.logout();
  perform tests.pass('12f. the owning business''s data is untouched');

  -- AI conversations are private per user even within a shared business.
  perform tests.login(alice);
  insert into public.ai_conversations (business_id, user_id, title) values (biz_a, alice, 'Cash question');
  perform tests.assert_raises(format('insert into public.ai_conversations (business_id, user_id) values (%L, %L)', biz_a, bob),
    'row-level security', 'cannot create a conversation for another user');
  perform tests.logout();
  perform tests.login(bob);
  perform tests.assert_eq((select count(*)::int from public.ai_conversations where business_id = biz_a), 0, 'foreign conversations hidden');
  perform tests.logout();
  perform tests.pass('12g. AI conversation history is scoped to the business and the user');
end;
$$;
