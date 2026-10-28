-- BizPilot AI · Part 2 — Finance Engine & Testing
-- Owner: Member 2 (see TEAM.md)
-- Inventory: required test 8 (movements reconcile to stock) + weighted average
-- cost, atomic sales, stock adjustments.
do $$
declare
  u uuid := tests.create_user('inv@example.com');
  biz uuid; prod uuid; prod2 uuid; sup uuid;
  r jsonb; v_qty int; v_val bigint; v_cogs bigint;
begin
  perform tests.login(u);
  biz := public.create_business('Inventory Shop', 'minimart', 'GHS', 1000000);
  insert into public.suppliers (business_id, name) values (biz, 'Supplier') returning id into sup;
  insert into public.products (business_id, name, selling_price_minor, low_stock_threshold)
  values (biz, 'Rice 5kg', 9000, 5) returning id into prod;
  insert into public.products (business_id, name, selling_price_minor) values (biz, 'Oil 1L', 3000) returning id into prod2;

  -- Weighted average: 3 @ 10.00 then 1 @ 11.00 → pool 41.00 for 4 units.
  perform public.record_stock_purchase(biz, jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 3, 'unit_cost_minor', 1000)),
                                       current_date - 3, gen_random_uuid());
  perform public.record_stock_purchase(biz, jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 1, 'unit_cost_minor', 1100)),
                                       current_date - 2, gen_random_uuid());
  select quantity_on_hand, inventory_value_minor into v_qty, v_val from public.products where id = prod;
  perform tests.assert_eq(v_qty, 4, 'quantity after purchases');
  perform tests.assert_eq(v_val, 4100::bigint, 'cost pool after purchases');

  -- Sell 1: removes round(4100/4) = 1025. Sell remaining 3: removes the rest (3075).
  perform public.record_sale(biz, 'cash', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 1, 'unit_price_minor', 9000)),
                             current_date - 1, gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'cogs'), 1025::bigint, 'COGS uses weighted average cost');
  perform public.record_sale(biz, 'cash', jsonb_build_array(jsonb_build_object('product_id', prod, 'quantity', 3, 'unit_price_minor', 9000)),
                             current_date - 1, gen_random_uuid());
  select quantity_on_hand, inventory_value_minor into v_qty, v_val from public.products where id = prod;
  perform tests.assert_eq(v_qty, 0, 'sold out');
  perform tests.assert_eq(v_val, 0::bigint, 'empty stock carries no value (no drift)');
  perform tests.assert_eq(tests.balance(biz, 'cogs'), 4100::bigint, 'total COGS equals total cost bought');
  perform tests.pass('weighted average cost: COGS uses the average and the pool empties exactly to zero');

  -- Atomicity: a sale with one valid and one out-of-stock line writes nothing.
  perform public.record_stock_purchase(biz, jsonb_build_array(jsonb_build_object('product_id', prod2, 'quantity', 2, 'unit_cost_minor', 2000)),
                                       current_date - 1, gen_random_uuid());
  perform tests.assert_raises(format(
    'select public.record_sale(%L, ''cash'', %L::jsonb, current_date, gen_random_uuid())', biz,
    jsonb_build_array(jsonb_build_object('product_id', prod2, 'quantity', 1, 'unit_price_minor', 3000),
                      jsonb_build_object('product_id', prod, 'quantity', 1, 'unit_price_minor', 9000))),
    'Not enough stock', 'out-of-stock line rejects the whole sale');
  perform tests.assert_eq((select quantity_on_hand from public.products where id = prod2), 2, 'valid line did not reduce stock');
  perform tests.assert_eq((select count(*)::int from public.transactions where business_id = biz and type = 'cash_sale'), 2,
                          'no partial sale transaction was written');
  perform tests.pass('a sale with any invalid line is rejected atomically (no partial stock or ledger writes)');

  -- Stock adjustments: loss at average cost, gain at given cost.
  perform public.record_stock_adjustment(biz, prod2, -1, 'Damaged in storage', current_date, gen_random_uuid());
  perform tests.assert_eq(tests.balance(biz, 'inventory_adjustment'), 2000::bigint, 'loss valued at average cost');
  perform public.record_stock_adjustment(biz, prod2, 3, 'Found during count', current_date, gen_random_uuid(), 2100);
  perform tests.assert_eq((select quantity_on_hand from public.products where id = prod2), 4, 'gain added');
  perform tests.assert_raises(format('select public.record_stock_adjustment(%L, %L, -10, ''count'', current_date, gen_random_uuid())', biz, prod2),
    'Not enough stock', 'cannot adjust below zero');
  perform tests.pass('stock adjustments post losses/gains at cost and cannot make stock negative');

  -- Opening stock only before any movement.
  perform tests.assert_raises(format('select public.record_opening_stock(%L, %L, 5, 1000, current_date, gen_random_uuid())', biz, prod2),
    'only be set before', 'opening stock rejected after movements');
  perform tests.pass('opening stock can only be recorded before other movements');

  -- 8. Movements reconcile to stock and the inventory ledger account.
  perform tests.assert_true(not exists (select 1 from public.check_inventory_integrity(biz)),
                            'quantity, value and ledger agree with the movement ledger');
  perform tests.assert_eq(
    (select sum(quantity_delta)::int from public.inventory_movements where product_id = prod2),
    (select quantity_on_hand from public.products where id = prod2), 'sum of movements = quantity on hand');
  perform tests.pass('8. inventory movements reconcile to the recorded stock quantity, value and ledger');

  -- Direct tampering with stock levels is impossible for app users.
  perform tests.assert_raises(format('update public.products set quantity_on_hand = 999 where id = %L', prod2),
    '42501', 'clients cannot write quantity_on_hand directly');
  perform tests.assert_raises(format('insert into public.inventory_movements (business_id, product_id, transaction_id, movement_type, movement_date, quantity_delta, value_delta_minor, quantity_after, value_after_minor) select %L, %L, id, ''adjustment'', current_date, 5, 0, 9, 0 from public.transactions where business_id = %L limit 1', biz, prod2, biz),
    '42501', 'clients cannot insert stock movements directly');
  perform tests.pass('stock levels and the movement ledger cannot be edited directly by clients');

  perform tests.logout();
  -- Ledger rows are immutable even for privileged roles.
  perform tests.assert_raises(format('update public.ledger_entries set amount_minor = amount_minor + 1 where business_id = %L', biz),
    'immutable', 'ledger lines cannot be updated');
  perform tests.assert_raises(format('update public.inventory_movements set quantity_delta = 1 where business_id = %L', biz),
    'immutable', 'movements cannot be updated');
  perform tests.assert_ledger_balanced(biz);
  perform tests.pass('ledger lines and stock movements are immutable');
end;
$$;
