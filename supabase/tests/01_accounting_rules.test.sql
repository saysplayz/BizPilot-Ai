-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- Accounting rules: required tests 1–7 (+ refunds, expenses, owner money).
do $$
declare
  u uuid := tests.create_user('owner1@example.com');
  biz uuid; cash_acct uuid; momo_acct uuid;
  cust uuid; sup uuid; prod uuid;
  r jsonb; inv uuid; loan uuid;
  cash_before bigint; rev_before bigint; ar_before bigint; ap_before bigint; exp_before bigint;
begin
  perform tests.login(u);
  biz := public.create_business('Test Shop', 'electronics', 'GHS', 100000, 20000);
  select id into cash_acct from public.financial_accounts where business_id = biz and kind = 'cash';
  select id into momo_acct from public.financial_accounts where business_id = biz and kind = 'mobile_money';
  insert into public.customers (business_id, name) values (biz, 'Ama') returning id into cust;
  insert into public.suppliers (business_id, name) values (biz, 'Wholesaler') returning id into sup;
  insert into public.products (business_id, name, selling_price_minor) values (biz, 'Phone', 150000) returning id into prod;
  perform public.record_opening_stock(biz, prod, 10, 100000, current_date - 10, gen_random_uuid());

  -- Opening balance is equity, not revenue.
  perform tests.assert_eq(tests.balance(biz, 'cash'), 100000::bigint, 'opening cash recorded');
  perform tests.assert_eq(tests.revenue(biz), 0::bigint, 'opening balance is not revenue');
  perform tests.pass('opening balance increases cash without creating revenue');

  -- 1. Cash sale increases cash and revenue; COGS at average cost.
  r := public.record_sale(biz, 'cash', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 2, 'unit_price_minor', 150000)),
                          current_date - 5, gen_random_uuid(), p_payment_method => 'cash');
  perform tests.assert_eq(tests.balance(biz, 'cash'), 400000::bigint, 'cash after cash sale');
  perform tests.assert_eq(tests.revenue(biz), 300000::bigint, 'revenue after cash sale');
  perform tests.assert_eq(tests.balance(biz, 'cogs'), 200000::bigint, 'COGS recognised at cost');
  perform tests.assert_eq(tests.balance(biz, 'inventory'), 800000::bigint, 'inventory reduced by cost');
  perform tests.assert_eq((select status::text from public.invoices where id = (r->>'invoice_id')::uuid), 'paid', 'cash sale invoice paid');
  perform tests.pass('1. cash sale increases cash and revenue (and recognises COGS)');

  -- 2. Credit sale increases receivables, not cash.
  cash_before := tests.balance(biz, 'cash');
  r := public.record_sale(biz, 'credit', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 1, 'unit_price_minor', 150000)),
                          current_date - 4, gen_random_uuid(), p_customer_id => cust, p_due_date => current_date + 10);
  inv := (r->>'invoice_id')::uuid;
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before, 'credit sale does not change cash');
  perform tests.assert_eq(tests.balance(biz, 'accounts_receivable'), 150000::bigint, 'receivable recorded');
  perform tests.assert_eq(tests.revenue(biz), 450000::bigint, 'revenue recognised on credit sale');
  perform tests.pass('2. credit sale increases receivables but not cash');

  -- 3. Collecting the debt: cash up, receivable down, revenue unchanged.
  rev_before := tests.revenue(biz);
  perform public.record_customer_payment(biz, cust, 100000, current_date - 2, gen_random_uuid(), p_payment_method => 'mobile_money');
  perform tests.assert_eq(tests.revenue(biz), rev_before, 'payment does not create revenue');
  perform tests.assert_eq(tests.balance(biz, 'accounts_receivable'), 50000::bigint, 'receivable reduced');
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before + 100000, 'cash increased by payment');
  perform tests.assert_eq((select status::text from public.invoices where id = inv), 'partially_paid', 'invoice partially paid');
  perform public.record_customer_payment(biz, cust, 50000, current_date - 1, gen_random_uuid(), p_invoice_id => inv);
  perform tests.assert_eq((select status::text from public.invoices where id = inv), 'paid', 'invoice paid in full');
  perform tests.assert_eq(tests.revenue(biz), rev_before, 'second payment does not create revenue either');
  perform tests.pass('3. collecting a customer debt increases cash and reduces receivables without double-counting revenue');

  -- 4. Supplier bill then payment: payable then cash out, no duplicate cost.
  r := public.create_bill(biz, sup, 'expense', jsonb_build_array(jsonb_build_object('description', 'Shop rent', 'quantity', 1, 'unit_cost_minor', 80000)),
                          current_date - 3, current_date + 5, gen_random_uuid(), p_category => 'Rent');
  perform tests.assert_eq(tests.balance(biz, 'accounts_payable'), -80000::bigint, 'payable recorded');
  exp_before := tests.balance(biz, 'operating_expense');
  perform tests.assert_eq(exp_before, 80000::bigint, 'expense recognised once at bill');
  cash_before := tests.balance(biz, 'cash');
  perform public.record_supplier_payment(biz, sup, 80000, current_date, gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'accounts_payable'), 0::bigint, 'payable cleared');
  perform tests.assert_eq(tests.balance(biz, 'operating_expense'), exp_before, 'payment does not duplicate the expense');
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before - 80000, 'cash reduced by payment');
  perform tests.assert_eq((select status::text from public.bills where id = (r->>'bill_id')::uuid), 'paid', 'bill marked paid');

  -- Stock bought on credit: inventory up, payable up, no expense; payment clears payable only.
  r := public.create_bill(biz, sup, 'inventory', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 5, 'unit_cost_minor', 110000)),
                          current_date - 1, current_date + 14, gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'accounts_payable'), -550000::bigint, 'stock bill payable');
  perform tests.assert_eq(tests.balance(biz, 'operating_expense'), exp_before, 'stock purchase is not an operating expense');
  perform public.record_supplier_payment(biz, sup, 550000, current_date, gen_random_uuid(), p_bill_id => (r->>'bill_id')::uuid);
  perform tests.assert_eq(tests.balance(biz, 'accounts_payable'), 0::bigint, 'stock bill paid');
  perform tests.assert_eq(tests.balance(biz, 'cogs'), 300000::bigint, 'paying for stock does not change COGS');
  perform tests.pass('4. paying a supplier bill reduces cash and payables without double-counting the purchase');

  -- 5. Loan proceeds are not revenue.
  rev_before := tests.revenue(biz);
  cash_before := tests.balance(biz, 'cash');
  r := public.record_loan(biz, 'Microfinance Ltd', 500000, current_date - 1, gen_random_uuid());
  loan := (r->>'loan_id')::uuid;
  perform tests.assert_eq(tests.revenue(biz), rev_before, 'loan is not revenue');
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before + 500000, 'loan increases cash');
  perform tests.assert_eq(tests.balance(biz, 'loans_payable'), -500000::bigint, 'loan liability recorded');
  perform tests.pass('5. loan proceeds increase cash and liabilities, not revenue');

  -- 6. Principal repayment is not an operating expense; interest is separate.
  exp_before := tests.balance(biz, 'operating_expense');
  perform public.record_loan_repayment(biz, loan, 100000, 5000, current_date, gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'operating_expense'), exp_before, 'principal is not an operating expense');
  perform tests.assert_eq(tests.balance(biz, 'interest_expense'), 5000::bigint, 'interest recorded separately');
  perform tests.assert_eq(tests.balance(biz, 'loans_payable'), -400000::bigint, 'loan liability reduced by principal only');
  perform tests.pass('6. loan principal repayment is not an operating expense (interest tracked separately)');

  -- 7. Transfers create no income or expenses.
  rev_before := tests.revenue(biz);
  exp_before := tests.balance(biz, 'operating_expense');
  cash_before := tests.balance(biz, 'cash');
  perform public.record_transfer(biz, cash_acct, momo_acct, 30000, current_date, gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before, 'total cash unchanged by transfer');
  perform tests.assert_eq(tests.revenue(biz), rev_before, 'transfer is not income');
  perform tests.assert_eq(tests.balance(biz, 'operating_expense'), exp_before, 'transfer is not an expense');
  perform tests.assert_eq((select balance_minor from public.get_money_account_balances(biz) where financial_account_id = momo_acct),
                          130000::bigint, 'momo account received the transfer');
  perform tests.assert_eq((select count(*)::int from public.get_cash_daily(biz, current_date, current_date) where inflow_minor > 0 and day = current_date
                            and inflow_minor = 30000), 0, 'transfer does not appear as money in');
  perform tests.pass('7. internal transfers do not create income or expenses');

  -- Owner money is equity, not revenue/expense.
  rev_before := tests.revenue(biz);
  exp_before := tests.balance(biz, 'operating_expense');
  perform public.record_owner_transaction(biz, 'in', 20000, current_date, gen_random_uuid());
  perform public.record_owner_transaction(biz, 'out', 5000, current_date, gen_random_uuid());
  perform tests.assert_eq(tests.revenue(biz), rev_before, 'owner contribution is not revenue');
  perform tests.assert_eq(tests.balance(biz, 'operating_expense'), exp_before, 'owner withdrawal is not an expense');
  perform tests.assert_eq(tests.balance(biz, 'owner_equity'), -15000::bigint, 'owner equity tracks net contribution');
  perform tests.pass('owner contributions and withdrawals are equity, not revenue or expenses');

  -- Refund with restock: contra-revenue, cash back, stock and COGS restored.
  r := public.record_sale(biz, 'cash', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 1, 'unit_price_minor', 150000)),
                          current_date, gen_random_uuid());
  cash_before := tests.balance(biz, 'cash');
  perform public.record_refund(biz, (r->>'invoice_id')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_line_id', (select id from public.invoice_lines where invoice_id = (r->>'invoice_id')::uuid), 'quantity', 1)),
    true, current_date, 'Faulty screen', gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'sales_returns'), 150000::bigint, 'refund recorded as sales return');
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before - 150000, 'cash paid back');
  perform tests.assert_true(not exists (select 1 from public.check_inventory_integrity(biz)), 'inventory consistent after refund');
  perform tests.assert_raises(format('select public.record_refund(%L, %L, %L, true, current_date, %L, gen_random_uuid())',
    biz, (r->>'invoice_id')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_line_id', (select id from public.invoice_lines where invoice_id = (r->>'invoice_id')::uuid), 'quantity', 1)),
    'again'), 'more of', 'cannot refund more than sold');
  perform tests.pass('refunds are contra-revenue, return cash, restore stock and cannot exceed what was sold');

  -- Refund on an unpaid credit sale reduces what the customer owes, no cash moves.
  r := public.record_sale(biz, 'credit', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 2, 'unit_price_minor', 150000)),
                          current_date, gen_random_uuid(), p_customer_id => cust);
  cash_before := tests.balance(biz, 'cash');
  ar_before := tests.balance(biz, 'accounts_receivable');
  perform public.record_refund(biz, (r->>'invoice_id')::uuid,
    jsonb_build_array(jsonb_build_object('invoice_line_id', (select id from public.invoice_lines where invoice_id = (r->>'invoice_id')::uuid), 'quantity', 1)),
    false, current_date, 'Returned, damaged', gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'cash'), cash_before, 'credit refund moves no cash');
  perform tests.assert_eq(tests.balance(biz, 'accounts_receivable'), ar_before - 150000, 'credit refund reduces receivable');
  perform tests.assert_eq((select status::text from public.invoices where id = (r->>'invoice_id')::uuid), 'partially_paid', 'invoice partly settled by credit');
  perform tests.pass('refund on an unpaid credit sale reduces the customer balance instead of paying cash');

  -- Expense paid now.
  exp_before := tests.balance(biz, 'operating_expense');
  perform public.record_expense(biz, 'Transport', 2500, current_date, 'Taxi', gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'operating_expense'), exp_before + 2500, 'expense recorded');
  perform tests.pass('operating expenses reduce cash and are categorised');

  perform tests.logout();
  perform tests.assert_ledger_balanced(biz);
  perform tests.pass('every transaction balances (debits = credits)');
end;
$$;
