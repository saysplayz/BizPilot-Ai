-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0007 Read/aggregation functions
-- SECURITY INVOKER: Row Level Security applies, so a caller only ever sees
-- their own businesses' rows. These return raw sums; business meaning
-- (revenue, gross profit, ...) is derived in one place in the app
-- (src/core/finance/metrics.ts) so every screen agrees.
-- =============================================================================

-- Balance of every ledger account as of a date (inclusive).
create or replace function public.get_account_balances(p_business_id uuid, p_as_of date default current_date)
returns table (account public.ledger_account, balance_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select le.account, sum(le.amount_minor)::bigint
    from public.ledger_entries le
   where le.business_id = p_business_id and le.entry_date <= p_as_of
   group by le.account;
$$;

-- Activity per ledger account and category within a date range (inclusive).
create or replace function public.get_period_activity(p_business_id uuid, p_from date, p_to date)
returns table (account public.ledger_account, category text, amount_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select le.account, le.category, sum(le.amount_minor)::bigint
    from public.ledger_entries le
   where le.business_id = p_business_id and le.entry_date between p_from and p_to
   group by le.account, le.category;
$$;

-- Daily money in / money out. Nets each transaction's cash lines first so
-- transfers between the business's own accounts (net zero) never show up as
-- money in or out. Voided records and their reversals cancel out.
create or replace function public.get_cash_daily(p_business_id uuid, p_from date, p_to date)
returns table (day date, inflow_minor bigint, outflow_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with per_txn as (
    select le.entry_date as day, le.transaction_id, sum(le.amount_minor) as net
      from public.ledger_entries le
     where le.business_id = p_business_id and le.account = 'cash'
       and le.entry_date between p_from and p_to
     group by le.entry_date, le.transaction_id
  ), paired as (
    -- Collapse a voided transaction with its reversal (same date) to zero.
    select p.day, coalesce(t.reversal_of, t.id) as root, sum(p.net) as net
      from per_txn p join public.transactions t on t.id = p.transaction_id
     group by p.day, coalesce(t.reversal_of, t.id)
  )
  select d::date,
         coalesce(sum(case when p.net > 0 then p.net end), 0)::bigint,
         coalesce(-sum(case when p.net < 0 then p.net end), 0)::bigint
    from generate_series(p_from, p_to, interval '1 day') d
    left join paired p on p.day = d::date
   group by d
   order by d;
$$;

-- Cash per money account.
create or replace function public.get_money_account_balances(p_business_id uuid)
returns table (financial_account_id uuid, name text, kind public.money_account_kind, balance_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select fa.id, fa.name, fa.kind, coalesce(sum(le.amount_minor), 0)::bigint
    from public.financial_accounts fa
    left join public.ledger_entries le
      on le.financial_account_id = fa.id and le.account = 'cash' and le.entry_date <= current_date
   where fa.business_id = p_business_id and fa.archived_at is null
   group by fa.id, fa.name, fa.kind
   order by fa.is_default desc, fa.name;
$$;

-- Open invoices (customers who owe money), oldest due first.
create or replace function public.get_receivables(p_business_id uuid)
returns table (
  invoice_id uuid, invoice_number text, customer_id uuid, customer_name text, customer_phone text,
  issue_date date, due_date date, total_minor bigint, outstanding_minor bigint,
  days_outstanding integer, days_overdue integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.invoice_number, c.id, c.name, c.phone, i.issue_date, i.due_date, i.total_minor,
         (i.total_minor - i.amount_paid_minor - i.amount_credited_minor)::bigint,
         (current_date - i.issue_date)::integer,
         greatest(current_date - i.due_date, 0)::integer
    from public.invoices i
    join public.customers c on c.id = i.customer_id
   where i.business_id = p_business_id and i.status in ('open', 'partially_paid')
   order by i.due_date, i.issue_date;
$$;

-- Open supplier bills, earliest due first.
create or replace function public.get_payables(p_business_id uuid)
returns table (
  bill_id uuid, bill_number text, supplier_id uuid, supplier_name text, kind text,
  bill_date date, due_date date, total_minor bigint, outstanding_minor bigint, days_overdue integer, status public.bill_status
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, b.bill_number, s.id, s.name, b.kind, b.bill_date, b.due_date, b.total_minor,
         (b.total_minor - b.amount_paid_minor)::bigint,
         greatest(current_date - b.due_date, 0)::integer,
         b.status
    from public.bills b
    join public.suppliers s on s.id = b.supplier_id
   where b.business_id = p_business_id and b.status in ('open', 'partially_paid')
   order by b.due_date, b.bill_date;
$$;

-- Units sold per product over the last N days (for fast/slow movers).
create or replace function public.get_product_velocity(p_business_id uuid, p_days integer default 30)
returns table (product_id uuid, name text, quantity_on_hand integer, low_stock_threshold integer,
               units_sold bigint, revenue_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.name, p.quantity_on_hand, p.low_stock_threshold,
         coalesce(s.units, 0)::bigint, coalesce(s.revenue, 0)::bigint
    from public.products p
    left join (
      select il.product_id,
             sum(il.quantity - il.refunded_quantity) as units,
             sum((il.quantity - il.refunded_quantity)::bigint * il.unit_price_minor) as revenue
        from public.invoice_lines il
        join public.invoices i on i.id = il.invoice_id
       where i.business_id = p_business_id and i.status <> 'void'
         and i.issue_date > current_date - greatest(p_days, 1)
         and il.product_id is not null
       group by il.product_id
    ) s on s.product_id = p.id
   where p.business_id = p_business_id and p.archived_at is null;
$$;

-- Month-by-month ledger activity for trend charts.
create or replace function public.get_monthly_activity(p_business_id uuid, p_months integer default 6)
returns table (month date, account public.ledger_account, amount_minor bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', le.entry_date)::date, le.account, sum(le.amount_minor)::bigint
    from public.ledger_entries le
   where le.business_id = p_business_id
     and le.entry_date >= (date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1) - 1))::date
     and le.entry_date <= current_date
   group by 1, 2
   order by 1;
$$;

-- Ledger vs stock-movement reconciliation. Returns only problem rows; an
-- empty result means quantities and values agree with the movement ledger
-- and the inventory ledger account equals the sum of product values.
create or replace function public.check_inventory_integrity(p_business_id uuid)
returns table (product_id uuid, problem text, expected bigint, actual bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, 'quantity_mismatch', coalesce(sum(m.quantity_delta), 0)::bigint, p.quantity_on_hand::bigint
    from public.products p
    left join public.inventory_movements m on m.product_id = p.id
   where p.business_id = p_business_id
   group by p.id
  having coalesce(sum(m.quantity_delta), 0) <> p.quantity_on_hand
  union all
  select p.id, 'value_mismatch', coalesce(sum(m.value_delta_minor), 0)::bigint, p.inventory_value_minor
    from public.products p
    left join public.inventory_movements m on m.product_id = p.id
   where p.business_id = p_business_id
   group by p.id
  having coalesce(sum(m.value_delta_minor), 0) <> p.inventory_value_minor
  union all
  select null::uuid, 'ledger_inventory_mismatch',
         (select coalesce(sum(inventory_value_minor), 0) from public.products where business_id = p_business_id)::bigint,
         (select coalesce(sum(amount_minor), 0) from public.ledger_entries
           where business_id = p_business_id and account = 'inventory')::bigint
   where (select coalesce(sum(inventory_value_minor), 0) from public.products where business_id = p_business_id)
      <> (select coalesce(sum(amount_minor), 0) from public.ledger_entries
           where business_id = p_business_id and account = 'inventory');
$$;

-- Everything the forecast engine needs, in one round trip.
create or replace function public.get_forecast_inputs(p_business_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'as_of', current_date,
    'business', (
      select jsonb_build_object(
        'id', b.id, 'name', b.name, 'currency', b.currency, 'is_demo', b.is_demo,
        'min_cash_reserve_minor', b.min_cash_reserve_minor,
        'opening_balance_set', b.opening_balance_set_at is not null)
      from public.businesses b where b.id = p_business_id),
    'cash_balance_minor', (
      select coalesce(sum(amount_minor), 0) from public.ledger_entries
       where business_id = p_business_id and account = 'cash' and entry_date <= current_date),
    'future_dated_cash_minor', (
      select coalesce(sum(amount_minor), 0) from public.ledger_entries
       where business_id = p_business_id and account = 'cash' and entry_date > current_date),
    'open_invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.invoice_id, 'number', r.invoice_number, 'customer_id', r.customer_id,
               'customer_name', r.customer_name, 'issue_date', r.issue_date, 'due_date', r.due_date,
               'outstanding_minor', r.outstanding_minor) order by r.due_date)
        from public.get_receivables(p_business_id) r), '[]'::jsonb),
    'open_bills', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.bill_id, 'number', r.bill_number, 'supplier_id', r.supplier_id,
               'supplier_name', r.supplier_name, 'kind', r.kind, 'due_date', r.due_date,
               'outstanding_minor', r.outstanding_minor) order by r.due_date)
        from public.get_payables(p_business_id) r), '[]'::jsonb),
    'scheduled_events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'direction', e.direction, 'label', e.label, 'category', e.category,
               'amount_minor', e.amount_minor, 'start_date', e.start_date, 'recurrence', e.recurrence,
               'end_date', e.end_date, 'confidence', e.confidence,
               'settled_dates', coalesce((
                  select jsonb_agg(s.occurrence_date order by s.occurrence_date)
                    from public.scheduled_event_settlements s
                    join public.transactions t on t.id = s.transaction_id and t.status = 'posted'
                   where s.scheduled_event_id = e.id), '[]'::jsonb)))
        from public.scheduled_cash_events e
       where e.business_id = p_business_id and e.active), '[]'::jsonb),
    'trailing_sales', (
      select jsonb_build_object(
        'days', 28,
        'cash_sales_minor', coalesce(sum(case when t.type = 'cash_sale' then t.amount_minor end), 0),
        'credit_sales_minor', coalesce(sum(case when t.type = 'credit_sale' then t.amount_minor end), 0),
        'stock_purchases_minor', coalesce(sum(case when t.type in ('inventory_purchase', 'supplier_bill')
                                                   and t.category = 'Stock purchases' then t.amount_minor end), 0),
        'first_txn_date', (select min(txn_date) from public.transactions
                            where business_id = p_business_id and status = 'posted'))
        from public.transactions t
       where t.business_id = p_business_id and t.status = 'posted'
         and t.txn_date > current_date - 28 and t.txn_date <= current_date)
  );
$$;
