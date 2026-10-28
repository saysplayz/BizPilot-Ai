-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- Demo business consistency + read functions used by the forecast and reports.
do $$
declare
  u uuid := tests.create_user('demo@example.com');
  other uuid := tests.create_user('real@example.com');
  real_biz uuid; demo uuid; demo2 uuid; fi jsonb; n int;
begin
  perform tests.login(other);
  real_biz := public.create_business('Real Shop', 'minimart', 'GHS', 10000);
  perform tests.logout();

  perform tests.login(u);
  demo := public.create_demo_business();
  fi := public.get_forecast_inputs(demo);

  perform tests.assert_eq((fi->>'cash_balance_minor')::bigint, 300000::bigint, 'demo cash available today is GH₵3,000');
  perform tests.assert_eq((fi->'business'->>'is_demo')::boolean, true, 'demo flagged');
  perform tests.assert_eq((select sum((x->>'outstanding_minor')::bigint) from jsonb_array_elements(fi->'open_bills') x)::bigint,
                          150000::bigint, 'supplier bill GH₵1,500 outstanding');
  perform tests.assert_eq((select (x->>'outstanding_minor')::bigint from jsonb_array_elements(fi->'open_invoices') x
                            where x->>'customer_name' = 'Ama Mensah'), 200000::bigint, 'Ama owes GH₵2,000');
  perform tests.assert_eq((select (x->>'due_date')::date from jsonb_array_elements(fi->'open_invoices') x
                            where x->>'customer_name' = 'Ama Mensah'), current_date + 10, 'Ama due in 10 days');
  perform tests.assert_eq((select (x->>'outstanding_minor')::bigint from jsonb_array_elements(fi->'open_invoices') x
                            where x->>'customer_name' = 'Yaw Boateng'), 45000::bigint, 'Yaw owes GH₵450 (overdue)');
  perform tests.assert_eq(jsonb_array_length(fi->'scheduled_events'), 1, 'one planned payment (rent)');
  perform tests.assert_eq((select count(*)::int from public.cashflow_scenarios where business_id = demo), 3, 'three saved scenarios');
  perform tests.assert_eq((select count(*)::int from public.products where business_id = demo and quantity_on_hand <= low_stock_threshold), 2,
                          'two low-stock products');
  perform tests.assert_true(not exists (select 1 from public.check_inventory_integrity(demo)), 'demo inventory consistent');
  perform tests.assert_true((select bool_and(balance_minor >= 0) from public.get_money_account_balances(demo)), 'no negative money account');
  perform tests.pass('demo business matches the story: GH₵3,000 cash, GH₵2,000 due from Ama, GH₵1,500 bill, rent planned, 3 scenarios');

  -- Recreating replaces the old demo rather than accumulating copies.
  demo2 := public.create_demo_business();
  perform tests.assert_true(demo2 <> demo, 'new demo id');
  perform tests.assert_eq((select count(*)::int from public.businesses where is_demo), 1, 'only one demo business');
  perform tests.pass('recreating the demo replaces the previous one');

  -- Demo data never leaks into real businesses.
  perform tests.assert_eq((select count(*)::int from public.transactions where business_id = real_biz), 0, 'real business untouched');
  perform tests.logout();
  perform tests.login(other);
  select count(*) into n from public.businesses where is_demo;
  perform tests.assert_eq(n, 0, 'other users cannot see someone else''s demo');
  perform tests.logout();
  perform tests.pass('demo records are separate from real businesses and other users');

  perform tests.login(u);
  -- Read functions agree with each other.
  perform tests.assert_eq(
    (select balance_minor from public.get_account_balances(demo2) where account = 'cash'),
    (select sum(balance_minor)::bigint from public.get_money_account_balances(demo2)), 'cash by account sums to cash balance');
  perform tests.assert_eq(
    (select balance_minor from public.get_account_balances(demo2) where account = 'accounts_receivable'),
    (select sum(outstanding_minor)::bigint from public.get_receivables(demo2)), 'receivables ledger = open invoices');
  perform tests.assert_eq(
    -(select balance_minor from public.get_account_balances(demo2) where account = 'accounts_payable'),
    (select sum(outstanding_minor)::bigint from public.get_payables(demo2)), 'payables ledger = open bills');
  perform tests.assert_eq((select count(*)::int from public.get_cash_daily(demo2, current_date - 6, current_date)), 7, 'one row per day');
  perform tests.assert_true((select sum(units_sold) from public.get_product_velocity(demo2, 30)) > 0, 'velocity computed');
  perform tests.pass('ledger balances agree with sub-ledgers (cash accounts, invoices, bills)');

  -- Scenario saving does not touch financial records.
  n := (select count(*) from public.ledger_entries where business_id = demo2);
  perform public.save_cashflow_scenario(demo2, 'Hire assistant', 'test', 30,
    '[{"kind":"recurring","direction":"out","amount_minor":80000,"interval":"monthly","start_offset":7,"label":"Assistant wage"}]'::jsonb);
  perform tests.assert_eq((select count(*)::int from public.ledger_entries where business_id = demo2), n, 'ledger unchanged by saving a scenario');
  perform tests.pass('11. saving a scenario does not change actual business records');

  -- Alerts de-duplicate by fingerprint and resolve when gone.
  perform public.sync_alerts(demo2, '[{"kind":"shortfall","severity":"critical","title":"Cash may run out","message":"m","fingerprint":"shortfall:2026-11-02"}]'::jsonb);
  perform public.sync_alerts(demo2, '[{"kind":"shortfall","severity":"critical","title":"Cash may run out","message":"m2","fingerprint":"shortfall:2026-11-02"}]'::jsonb);
  perform tests.assert_eq((select count(*)::int from public.alerts where business_id = demo2), 1, 'same alert not duplicated');
  perform public.dismiss_alert(demo2, (select id from public.alerts where business_id = demo2));
  perform tests.assert_eq((select count(*)::int from public.sync_alerts(demo2, '[{"kind":"shortfall","severity":"critical","title":"t","message":"m","fingerprint":"shortfall:2026-11-02"}]'::jsonb)), 0,
                          'dismissed alert stays hidden while unchanged');
  perform tests.assert_eq((select count(*)::int from public.sync_alerts(demo2, '[]'::jsonb)), 0, 'empty set');
  perform tests.assert_true((select resolved_at is not null from public.alerts where business_id = demo2), 'alert resolved when situation clears');
  perform tests.pass('alerts are de-duplicated, stay dismissed, and resolve when the situation clears');

  -- AI quota.
  perform tests.assert_eq((public.consume_ai_quota()->>'allowed')::boolean, true, 'quota allows first request');
  perform tests.pass('AI rate limit records usage per user');
  perform tests.logout();
  perform tests.assert_ledger_balanced(demo2);
end;
$$;
