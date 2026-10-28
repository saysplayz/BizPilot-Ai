-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- Required test 13: invalid negative amounts and invalid dates are handled.
do $$
declare
  u uuid := tests.create_user('val@example.com');
  biz uuid; cust uuid; sup uuid; prod uuid; acct uuid; loan uuid;
begin
  perform tests.login(u);
  biz := public.create_business('Validation Shop', 'wholesale');
  select id into acct from public.financial_accounts where business_id = biz and kind = 'cash';
  insert into public.customers (business_id, name, credit_limit_minor) values (biz, 'Limited', 10000) returning id into cust;
  insert into public.suppliers (business_id, name) values (biz, 'S') returning id into sup;
  insert into public.products (business_id, name, selling_price_minor) values (biz, 'Item', 500) returning id into prod;

  perform tests.assert_raises(format('select public.record_expense(%L, ''Rent'', -100, current_date, ''x'', gen_random_uuid())', biz),
    'greater than zero', 'negative expense');
  perform tests.assert_raises(format('select public.record_expense(%L, ''Rent'', 0, current_date, ''x'', gen_random_uuid())', biz),
    'greater than zero', 'zero expense');
  perform tests.assert_raises(format('select public.record_customer_payment(%L, %L, -5, current_date, gen_random_uuid())', biz, cust),
    'greater than zero', 'negative payment');
  perform tests.assert_raises(format('select public.record_sale(%L, ''cash'', ''[{"description":"x","quantity":1,"unit_price_minor":-100}]''::jsonb, current_date, gen_random_uuid())', biz),
    'price of zero or more', 'negative price');
  perform tests.assert_raises(format('select public.record_sale(%L, ''cash'', ''[{"description":"x","quantity":0,"unit_price_minor":100}]''::jsonb, current_date, gen_random_uuid())', biz),
    'quantity greater than zero', 'zero quantity');
  perform tests.assert_raises(format('select public.record_sale(%L, ''cash'', ''[{"description":"x","quantity":1.5,"unit_price_minor":100}]''::jsonb, current_date, gen_random_uuid())', biz),
    '22P02', 'fractional quantity rejected');
  perform tests.assert_raises(format('select public.record_transfer(%L, %L, %L, 100, current_date, gen_random_uuid())', biz, acct, acct),
    'two different', 'transfer to same account');
  perform tests.assert_raises(format('select public.record_loan(%L, ''Bank'', -1, current_date, gen_random_uuid())', biz),
    'greater than zero', 'negative loan');
  perform tests.assert_raises('select public.create_business(''Bad'', ''other'', ''GHS'', -1)', 'cannot be negative', 'negative opening cash');
  perform tests.pass('13a. negative and zero amounts / quantities are rejected with clear messages');

  perform tests.assert_raises(format('select public.record_expense(%L, ''Rent'', 100, date ''1999-12-31'', ''x'', gen_random_uuid())', biz),
    'outside the allowed range', 'ancient date');
  perform tests.assert_raises(format('select public.record_expense(%L, ''Rent'', 100, current_date + 400, ''x'', gen_random_uuid())', biz),
    'outside the allowed range', 'far-future date');
  perform tests.assert_raises(format('select public.record_expense(%L, ''Rent'', 100, null, ''x'', gen_random_uuid())', biz),
    'date is required', 'missing date');
  perform tests.assert_raises(format('select public.record_sale(%L, ''credit'', ''[{"description":"x","quantity":1,"unit_price_minor":100}]''::jsonb, current_date, gen_random_uuid(), p_customer_id => %L, p_due_date => current_date - 1)', biz, cust),
    'due date cannot be before', 'due date before sale');
  perform tests.assert_raises(format('select public.create_bill(%L, %L, ''expense'', ''[{"description":"x","quantity":1,"unit_cost_minor":100}]''::jsonb, current_date, current_date - 2, gen_random_uuid())', biz, sup),
    'due date cannot be before', 'bill due before bill date');
  perform tests.pass('13b. invalid, missing and out-of-range dates are rejected');

  perform tests.assert_raises(format('select public.record_sale(%L, ''credit'', ''[{"description":"x","quantity":1,"unit_price_minor":20000}]''::jsonb, current_date, gen_random_uuid(), p_customer_id => %L)', biz, cust),
    'credit limit', 'credit limit enforced');
  perform tests.assert_raises(format('select public.record_sale(%L, ''credit'', ''[{"description":"x","quantity":1,"unit_price_minor":100}]''::jsonb, current_date, gen_random_uuid())', biz),
    'Choose the customer', 'credit sale needs a customer');
  perform tests.assert_raises(format('select public.record_sale(%L, ''cash'', ''[]''::jsonb, current_date, gen_random_uuid())', biz),
    'at least one item', 'empty sale');
  perform tests.assert_raises(format('select public.record_expense(%L, ''Rent'', 100, current_date, ''x'', null)', biz),
    'idempotency key is required', 'missing idempotency key');
  perform tests.assert_raises(format('select public.record_supplier_payment(%L, %L, 100, current_date, gen_random_uuid())', biz, sup),
    'no unpaid bills', 'paying a supplier with nothing owed');
  loan := (public.record_loan(biz, 'Bank', 10000, current_date, gen_random_uuid())->>'loan_id')::uuid;
  perform tests.assert_raises(format('select public.record_loan_repayment(%L, %L, 20000, 0, current_date, gen_random_uuid())', biz, loan),
    'more than', 'cannot repay more principal than owed');
  perform tests.pass('13c. business rules (credit limits, overpayments, missing parties) are enforced');

  -- Table-level constraints as a second line of defence.
  perform tests.assert_raises(format('insert into public.customers (business_id, name, phone) values (%L, ''x'', ''not a phone'')', biz),
    '23514', 'phone format constraint');
  perform tests.assert_raises(format('insert into public.products (business_id, name, selling_price_minor) values (%L, ''x'', -1)', biz),
    '23514', 'negative price constraint');
  perform tests.assert_raises(format('insert into public.customers (business_id, name) values (%L, ''   '')', biz),
    '23514', 'blank name constraint');
  perform tests.pass('13d. table constraints reject malformed master data');
  perform tests.logout();
end;
$$;
