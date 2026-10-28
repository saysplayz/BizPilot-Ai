-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0005 Posting functions (public RPC API)
--
-- Every financial write in the app goes through one of these functions.
--   * Each runs in a single database transaction: ledger lines, stock
--     movements, invoices/bills, payments and audit rows succeed or fail
--     together.
--   * Each takes an idempotency key; replaying the same request returns the
--     original result instead of posting twice.
--   * SECURITY DEFINER + explicit membership checks; clients have no direct
--     INSERT/UPDATE rights on ledger tables.
--
-- Accounting rules (debit +, credit -):
--   cash sale        Dr cash           Cr sales_revenue;  Dr cogs Cr inventory
--   credit sale      Dr receivable     Cr sales_revenue;  Dr cogs Cr inventory
--   customer payment Dr cash           Cr receivable         (no revenue)
--   stock purchase   Dr inventory      Cr cash | payable
--   expense bill     Dr expense        Cr payable
--   supplier payment Dr payable        Cr cash               (no expense)
--   expense          Dr expense        Cr cash
--   loan received    Dr cash           Cr loans_payable      (not revenue)
--   loan repayment   Dr loans_payable  Dr interest_expense   Cr cash
--   owner in / out   Dr cash Cr owner_equity / reverse      (not revenue/expense)
--   transfer         Dr cash(to)       Cr cash(from)         (no income/expense)
--   refund           Dr sales_returns  Cr receivable | cash; restock Dr inventory Cr cogs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Business setup
-- ---------------------------------------------------------------------------
create or replace function public.create_business(
  p_name text,
  p_business_type public.business_type default 'other',
  p_currency text default 'GHS',
  p_opening_cash_minor bigint default null,
  p_min_cash_reserve_minor bigint default null,
  p_opening_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_business_id uuid;
  v_cash_account uuid;
  v_txn uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_opening_cash_minor is not null and p_opening_cash_minor < 0 then
    raise exception 'Opening cash cannot be negative' using errcode = 'P0001';
  end if;
  if p_min_cash_reserve_minor is not null and p_min_cash_reserve_minor < 0 then
    raise exception 'Minimum cash reserve cannot be negative' using errcode = 'P0001';
  end if;

  insert into public.businesses (name, business_type, currency, min_cash_reserve_minor, created_by)
  values (private.require_text(p_name, 'Business name', 120), coalesce(p_business_type, 'other'),
          upper(coalesce(nullif(btrim(p_currency), ''), 'GHS')), p_min_cash_reserve_minor, v_uid)
  returning id into v_business_id;

  insert into public.business_memberships (business_id, user_id, role)
  values (v_business_id, v_uid, 'owner');

  insert into public.financial_accounts (business_id, name, kind, is_default)
  values (v_business_id, 'Cash', 'cash', true)
  returning id into v_cash_account;

  insert into public.financial_accounts (business_id, name, kind)
  values (v_business_id, 'Mobile Money', 'mobile_money');

  if p_opening_cash_minor is not null then
    if p_opening_cash_minor > 0 then
      v_txn := private.insert_txn(v_business_id, 'opening_balance', coalesce(p_opening_date, current_date),
                                  'Opening cash balance', p_opening_cash_minor, gen_random_uuid(),
                                  p_account_id => v_cash_account);
      perform private.post_line(v_business_id, v_txn, 'cash', p_opening_cash_minor, coalesce(p_opening_date, current_date), v_cash_account);
      perform private.post_line(v_business_id, v_txn, 'opening_balance_equity', -p_opening_cash_minor, coalesce(p_opening_date, current_date));
    end if;
    update public.businesses set opening_balance_set_at = now() where id = v_business_id;
  end if;

  perform private.audit(v_business_id, 'create', 'business', v_business_id,
    jsonb_build_object('name', p_name, 'opening_cash_minor', p_opening_cash_minor));
  return v_business_id;
end;
$$;

-- Record (or add) an opening balance for one money account after setup.
create or replace function public.record_opening_balance(
  p_business_id uuid,
  p_financial_account_id uuid,
  p_amount_minor bigint,
  p_txn_date date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_account uuid;
begin
  perform private.assert_member(p_business_id, array['owner','manager']::public.business_role[]);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['opening_balance']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  if p_amount_minor is null or p_amount_minor < 0 then
    raise exception 'Opening balance cannot be negative' using errcode = 'P0001';
  end if;
  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, null);

  if exists (
    select 1 from public.transactions t
     where t.business_id = p_business_id and t.type = 'opening_balance' and t.status = 'posted'
       and t.financial_account_id = v_account
  ) then
    raise exception 'This account already has an opening balance. Void it first to change it.' using errcode = 'P0001';
  end if;

  update public.businesses set opening_balance_set_at = coalesce(opening_balance_set_at, now())
   where id = p_business_id;

  if p_amount_minor = 0 then
    return jsonb_build_object('transaction_id', null, 'replayed', false);
  end if;

  v_txn := private.insert_txn(p_business_id, 'opening_balance', p_txn_date, 'Opening balance',
                              p_amount_minor, p_idempotency_key, p_account_id => v_account);
  perform private.post_line(p_business_id, v_txn, 'cash', p_amount_minor, p_txn_date, v_account);
  perform private.post_line(p_business_id, v_txn, 'opening_balance_equity', -p_amount_minor, p_txn_date);
  perform private.audit(p_business_id, 'post', 'transaction', v_txn, jsonb_build_object('type', 'opening_balance', 'amount_minor', p_amount_minor));
  return private.txn_result(v_txn, false);
end;
$$;

-- Opening stock for a product the shop already holds when it starts using the app.
create or replace function public.record_opening_stock(
  p_business_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_unit_cost_minor bigint,
  p_txn_date date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_value bigint;
  v_name text;
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['opening_balance']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be a whole number greater than zero' using errcode = 'P0001';
  end if;
  if p_unit_cost_minor is null or p_unit_cost_minor < 0 then
    raise exception 'Unit cost cannot be negative' using errcode = 'P0001';
  end if;
  select name into v_name from public.products
   where id = p_product_id and business_id = p_business_id and archived_at is null;
  if v_name is null then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.inventory_movements where product_id = p_product_id) then
    raise exception 'Opening stock can only be set before any other stock movement. Use a stock adjustment instead.' using errcode = 'P0001';
  end if;

  v_value := p_quantity::bigint * p_unit_cost_minor;
  v_txn := private.insert_txn(p_business_id, 'opening_balance', p_txn_date,
                              'Opening stock: ' || v_name, v_value, p_idempotency_key);
  perform private.stock_in(p_business_id, p_product_id, p_quantity, v_value, v_txn, p_txn_date, 'opening', null, true);
  perform private.post_line(p_business_id, v_txn, 'inventory', v_value, p_txn_date);
  perform private.post_line(p_business_id, v_txn, 'opening_balance_equity', -v_value, p_txn_date);
  -- A zero-cost opening stock posts no ledger lines; keep the header honest.
  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'opening_stock', 'product_id', p_product_id, 'quantity', p_quantity, 'value_minor', v_value));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales
-- p_lines: [{"product_id": uuid|null, "description": text|null,
--            "quantity": int, "unit_price_minor": int}]
-- ---------------------------------------------------------------------------
create or replace function public.record_sale(
  p_business_id uuid,
  p_sale_kind text,
  p_lines jsonb,
  p_txn_date date,
  p_idempotency_key uuid,
  p_customer_id uuid default null,
  p_due_date date default null,
  p_payment_method public.payment_method default 'cash',
  p_financial_account_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_source public.txn_source default 'manual',
  p_import_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_invoice uuid;
  v_account uuid;
  v_total bigint := 0;
  v_cogs bigint;
  v_line record;
  v_product record;
  v_desc text;
  v_due date;
  v_terms integer;
  v_limit bigint;
  v_customer_name text;
  v_count integer;
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['cash_sale','credit_sale']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  if p_sale_kind not in ('cash', 'credit') then
    raise exception 'Sale type must be cash or credit' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item to the sale' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'A sale can have at most 100 items' using errcode = 'P0001';
  end if;
  perform private.require_valid_date(p_txn_date);

  if p_customer_id is not null then
    select name, payment_terms_days, credit_limit_minor into v_customer_name, v_terms, v_limit
      from public.customers where id = p_customer_id and business_id = p_business_id;
    if v_customer_name is null then
      raise exception 'Customer not found' using errcode = 'P0001';
    end if;
  end if;

  -- Validate lines and compute the total before writing anything.
  for v_line in
    select * from jsonb_to_recordset(p_lines)
      as x(product_id uuid, description text, quantity integer, unit_price_minor bigint)
  loop
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'Each item needs a quantity greater than zero' using errcode = 'P0001';
    end if;
    if v_line.unit_price_minor is null or v_line.unit_price_minor < 0 then
      raise exception 'Each item needs a price of zero or more' using errcode = 'P0001';
    end if;
    if v_line.product_id is null and btrim(coalesce(v_line.description, '')) = '' then
      raise exception 'Each item needs a product or a description' using errcode = 'P0001';
    end if;
    v_total := v_total + v_line.quantity::bigint * v_line.unit_price_minor;
  end loop;

  perform private.require_positive(v_total, 'Sale total');

  if p_sale_kind = 'credit' then
    if p_customer_id is null then
      raise exception 'Choose the customer who will pay later' using errcode = 'P0001';
    end if;
    v_due := coalesce(p_due_date, p_txn_date + coalesce(v_terms, 7));
    if v_due < p_txn_date then
      raise exception 'The due date cannot be before the sale date' using errcode = 'P0001';
    end if;
    if v_limit is not null and private.customer_outstanding(p_business_id, p_customer_id) + v_total > v_limit then
      raise exception '% would owe more than their credit limit. Collect a payment or raise their limit first.', v_customer_name
        using errcode = 'P0001';
    end if;
  else
    v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
    v_due := p_txn_date;
  end if;

  v_txn := private.insert_txn(
    p_business_id,
    case p_sale_kind when 'cash' then 'cash_sale' else 'credit_sale' end::public.txn_type,
    p_txn_date,
    case when v_customer_name is not null then 'Sale to ' || v_customer_name else 'Sale' end,
    v_total, p_idempotency_key, p_source,
    case when p_sale_kind = 'cash' then p_payment_method end,
    v_account, p_customer_id, null, 'Sales', p_reference, p_notes, p_import_fingerprint
  );

  insert into public.invoices (business_id, invoice_number, sale_kind, customer_id, transaction_id,
                               issue_date, due_date, total_minor, amount_paid_minor, status, notes)
  values (p_business_id, private.next_document_number(p_business_id, 'invoice'), p_sale_kind,
          p_customer_id, v_txn, p_txn_date, v_due, v_total,
          case when p_sale_kind = 'cash' then v_total else 0 end,
          case when p_sale_kind = 'cash' then 'paid' else 'open' end::public.invoice_status,
          private.clean_text(p_notes))
  returning id into v_invoice;

  -- Revenue and the asset side.
  if p_sale_kind = 'cash' then
    perform private.post_line(p_business_id, v_txn, 'cash', v_total, p_txn_date, v_account);
  else
    perform private.post_line(p_business_id, v_txn, 'accounts_receivable', v_total, p_txn_date, null, p_customer_id);
  end if;
  perform private.post_line(p_business_id, v_txn, 'sales_revenue', -v_total, p_txn_date, null, p_customer_id, p_category => 'Sales');

  -- Lines, stock and cost of goods sold (locks products in a stable order).
  v_count := 0;
  for v_line in
    select x.*
      from rows from (jsonb_to_recordset(p_lines)
             as (product_id uuid, description text, quantity integer, unit_price_minor bigint))
           with ordinality as x(product_id, description, quantity, unit_price_minor, ord)
     order by x.product_id nulls last, x.ord
  loop
    v_count := v_count + 1;
    v_cogs := 0;
    v_desc := btrim(coalesce(v_line.description, ''));
    if v_line.product_id is not null then
      select id, name, archived_at into v_product from public.products
       where id = v_line.product_id and business_id = p_business_id;
      if v_product.id is null then
        raise exception 'Product not found' using errcode = 'P0001';
      end if;
      if v_product.archived_at is not null then
        raise exception '"%" is archived and cannot be sold', v_product.name using errcode = 'P0001';
      end if;
      if v_desc = '' then v_desc := v_product.name; end if;
      v_cogs := private.stock_out(p_business_id, v_line.product_id, v_line.quantity, v_txn, p_txn_date, 'sale');
      perform private.post_line(p_business_id, v_txn, 'cogs', v_cogs, p_txn_date);
      perform private.post_line(p_business_id, v_txn, 'inventory', -v_cogs, p_txn_date);
    end if;

    insert into public.invoice_lines (business_id, invoice_id, product_id, description, quantity,
                                      unit_price_minor, line_total_minor, cost_minor)
    values (p_business_id, v_invoice, v_line.product_id, left(v_desc, 200), v_line.quantity,
            v_line.unit_price_minor, v_line.quantity::bigint * v_line.unit_price_minor, v_cogs);
  end loop;

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', p_sale_kind || '_sale', 'amount_minor', v_total, 'invoice_id', v_invoice, 'lines', v_count));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer payment against open invoices (specific invoice, or oldest first).
-- ---------------------------------------------------------------------------
create or replace function public.record_customer_payment(
  p_business_id uuid,
  p_customer_id uuid,
  p_amount_minor bigint,
  p_payment_date date,
  p_idempotency_key uuid,
  p_payment_method public.payment_method default 'cash',
  p_financial_account_id uuid default null,
  p_invoice_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_source public.txn_source default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_payment uuid;
  v_account uuid;
  v_name text;
  v_owed bigint;
  v_remaining bigint;
  v_apply bigint;
  v_inv record;
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['customer_payment']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  perform private.require_positive(p_amount_minor, 'Payment amount');
  perform private.require_valid_date(p_payment_date);

  select name into v_name from public.customers where id = p_customer_id and business_id = p_business_id;
  if v_name is null then
    raise exception 'Customer not found' using errcode = 'P0001';
  end if;

  -- Lock the invoices this payment can touch.
  perform 1 from public.invoices
   where business_id = p_business_id and customer_id = p_customer_id
     and status in ('open', 'partially_paid')
     and (p_invoice_id is null or id = p_invoice_id)
   order by due_date, issue_date, id
   for update;

  select coalesce(sum(total_minor - amount_paid_minor - amount_credited_minor), 0)
    into v_owed
    from public.invoices
   where business_id = p_business_id and customer_id = p_customer_id
     and status in ('open', 'partially_paid')
     and (p_invoice_id is null or id = p_invoice_id);

  if p_invoice_id is not null and not exists (
    select 1 from public.invoices where id = p_invoice_id and business_id = p_business_id and customer_id = p_customer_id
  ) then
    raise exception 'That invoice does not belong to this customer' using errcode = 'P0001';
  end if;

  if v_owed = 0 then
    raise exception '% has nothing outstanding to pay', v_name using errcode = 'P0001';
  end if;
  if p_amount_minor > v_owed then
    raise exception 'This payment is more than the % that % owes. Record only the amount owed.', private.fmt_money(v_owed), v_name
      using errcode = 'P0001';
  end if;

  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
  v_txn := private.insert_txn(p_business_id, 'customer_payment', p_payment_date, 'Payment from ' || v_name,
                              p_amount_minor, p_idempotency_key, p_source, p_payment_method, v_account,
                              p_customer_id, null, null, p_reference, p_notes);

  perform private.post_line(p_business_id, v_txn, 'cash', p_amount_minor, p_payment_date, v_account);
  perform private.post_line(p_business_id, v_txn, 'accounts_receivable', -p_amount_minor, p_payment_date, null, p_customer_id);

  insert into public.payments (business_id, direction, transaction_id, customer_id, amount_minor,
                               payment_date, method, financial_account_id)
  values (p_business_id, 'in', v_txn, p_customer_id, p_amount_minor, p_payment_date, p_payment_method, v_account)
  returning id into v_payment;

  v_remaining := p_amount_minor;
  for v_inv in
    select id, total_minor - amount_paid_minor - amount_credited_minor as outstanding
      from public.invoices
     where business_id = p_business_id and customer_id = p_customer_id
       and status in ('open', 'partially_paid')
       and (p_invoice_id is null or id = p_invoice_id)
     order by due_date, issue_date, id
  loop
    exit when v_remaining = 0;
    v_apply := least(v_remaining, v_inv.outstanding);
    continue when v_apply = 0;
    insert into public.payment_allocations (business_id, payment_id, invoice_id, amount_minor)
    values (p_business_id, v_payment, v_inv.id, v_apply);
    update public.invoices set amount_paid_minor = amount_paid_minor + v_apply where id = v_inv.id;
    perform private.refresh_invoice_status(v_inv.id);
    v_remaining := v_remaining - v_apply;
  end loop;

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'customer_payment', 'amount_minor', p_amount_minor, 'customer_id', p_customer_id));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Supplier bills (draft -> posted). p_lines:
--   inventory kind: [{"product_id": uuid, "quantity": int, "unit_cost_minor": int, "description": text?}]
--   expense kind:   [{"description": text, "quantity": int, "unit_cost_minor": int}]
-- ---------------------------------------------------------------------------
create or replace function private.post_bill_internal(
  p_business_id uuid, p_bill_id uuid, p_key uuid, p_source public.txn_source
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_txn uuid;
  v_line record;
  v_supplier_name text;
begin
  select * into v_bill from public.bills where id = p_bill_id and business_id = p_business_id for update;
  if v_bill.id is null then
    raise exception 'Bill not found' using errcode = 'P0001';
  end if;
  if v_bill.status <> 'draft' then
    raise exception 'Only draft bills can be posted' using errcode = 'P0001';
  end if;
  select name into v_supplier_name from public.suppliers where id = v_bill.supplier_id;

  v_txn := private.insert_txn(p_business_id, 'supplier_bill', v_bill.bill_date,
                              'Bill ' || v_bill.bill_number || ' from ' || v_supplier_name,
                              v_bill.total_minor, p_key, p_source, null, null, null, v_bill.supplier_id,
                              case when v_bill.kind = 'inventory' then 'Stock purchases' else v_bill.category end,
                              v_bill.supplier_reference, v_bill.notes);

  if v_bill.kind = 'inventory' then
    for v_line in
      select * from public.bill_lines where bill_id = p_bill_id order by product_id, id
    loop
      perform private.stock_in(p_business_id, v_line.product_id, v_line.quantity, v_line.line_total_minor,
                               v_txn, v_bill.bill_date, 'purchase', 'Bill ' || v_bill.bill_number, true);
    end loop;
    perform private.post_line(p_business_id, v_txn, 'inventory', v_bill.total_minor, v_bill.bill_date);
  else
    perform private.post_line(p_business_id, v_txn, 'operating_expense', v_bill.total_minor, v_bill.bill_date,
                              null, null, v_bill.supplier_id, null, coalesce(v_bill.category, 'Other'));
  end if;
  perform private.post_line(p_business_id, v_txn, 'accounts_payable', -v_bill.total_minor, v_bill.bill_date,
                            null, null, v_bill.supplier_id);

  update public.bills set status = 'open', transaction_id = v_txn where id = p_bill_id;
  perform private.audit(p_business_id, 'post', 'bill', p_bill_id, jsonb_build_object('transaction_id', v_txn));
  return v_txn;
end;
$$;

create or replace function public.create_bill(
  p_business_id uuid,
  p_supplier_id uuid,
  p_kind text,
  p_lines jsonb,
  p_bill_date date,
  p_due_date date,
  p_idempotency_key uuid,
  p_post boolean default true,
  p_category text default null,
  p_supplier_reference text default null,
  p_notes text default null,
  p_source public.txn_source default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill uuid;
  v_txn uuid;
  v_total bigint := 0;
  v_line record;
  v_due date;
  v_terms integer;
begin
  perform private.assert_member(p_business_id);
  select id, transaction_id into v_bill, v_txn from public.bills
   where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_bill is not null then
    return jsonb_strip_nulls(jsonb_build_object('bill_id', v_bill, 'transaction_id', v_txn, 'replayed', true));
  end if;

  if p_kind not in ('inventory', 'expense') then
    raise exception 'Bill type must be inventory or expense' using errcode = 'P0001';
  end if;
  perform private.require_valid_date(p_bill_date);
  select payment_terms_days into v_terms from public.suppliers where id = p_supplier_id and business_id = p_business_id;
  if not found then
    raise exception 'Supplier not found' using errcode = 'P0001';
  end if;
  v_due := coalesce(p_due_date, p_bill_date + coalesce(v_terms, 0));
  if v_due < p_bill_date then
    raise exception 'The due date cannot be before the bill date' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line to the bill' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'A bill can have at most 100 lines' using errcode = 'P0001';
  end if;

  for v_line in
    select * from jsonb_to_recordset(p_lines)
      as x(product_id uuid, description text, quantity integer, unit_cost_minor bigint)
  loop
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'Each line needs a quantity greater than zero' using errcode = 'P0001';
    end if;
    if v_line.unit_cost_minor is null or v_line.unit_cost_minor < 0 then
      raise exception 'Each line needs a cost of zero or more' using errcode = 'P0001';
    end if;
    if p_kind = 'inventory' then
      if v_line.product_id is null or not exists (
        select 1 from public.products where id = v_line.product_id and business_id = p_business_id and archived_at is null
      ) then
        raise exception 'Each stock line needs a valid, active product' using errcode = 'P0001';
      end if;
    elsif btrim(coalesce(v_line.description, '')) = '' then
      raise exception 'Each expense line needs a description' using errcode = 'P0001';
    end if;
    v_total := v_total + v_line.quantity::bigint * v_line.unit_cost_minor;
  end loop;
  perform private.require_positive(v_total, 'Bill total');

  insert into public.bills (business_id, bill_number, supplier_reference, kind, supplier_id, bill_date, due_date,
                            total_minor, status, category, notes, idempotency_key, created_by)
  values (p_business_id, private.next_document_number(p_business_id, 'bill'), private.clean_text(p_supplier_reference, 80),
          p_kind, p_supplier_id, p_bill_date, v_due, v_total, 'draft',
          case when p_kind = 'expense' then coalesce(private.clean_text(p_category, 60), 'Other') end,
          private.clean_text(p_notes), p_idempotency_key, auth.uid())
  returning id into v_bill;

  insert into public.bill_lines (business_id, bill_id, product_id, description, quantity, unit_cost_minor, line_total_minor)
  select p_business_id, v_bill, x.product_id,
         left(coalesce(nullif(btrim(x.description), ''), p.name), 200),
         x.quantity, x.unit_cost_minor, x.quantity::bigint * x.unit_cost_minor
    from jsonb_to_recordset(p_lines) as x(product_id uuid, description text, quantity integer, unit_cost_minor bigint)
    left join public.products p on p.id = x.product_id;

  perform private.audit(p_business_id, 'create', 'bill', v_bill, jsonb_build_object('total_minor', v_total, 'kind', p_kind));

  if coalesce(p_post, true) then
    -- The bill's own idempotency key doubles as the posting transaction key.
    v_txn := private.post_bill_internal(p_business_id, v_bill, p_idempotency_key, p_source);
  end if;

  return jsonb_strip_nulls(jsonb_build_object('bill_id', v_bill, 'transaction_id', v_txn, 'replayed', false));
end;
$$;

create or replace function public.post_bill(p_business_id uuid, p_bill_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['supplier_bill']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;
  v_txn := private.post_bill_internal(p_business_id, p_bill_id, p_idempotency_key, 'manual');
  return private.txn_result(v_txn, false);
end;
$$;

-- Discard a draft bill (posted bills are corrected with void_transaction).
create or replace function public.discard_draft_bill(p_business_id uuid, p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_member(p_business_id);
  update public.bills set status = 'void'
   where id = p_bill_id and business_id = p_business_id and status = 'draft';
  if not found then
    raise exception 'Only draft bills can be discarded' using errcode = 'P0001';
  end if;
  perform private.audit(p_business_id, 'discard', 'bill', p_bill_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock purchase paid immediately. (Stock bought on credit = create_bill with
-- kind 'inventory'.) If a supplier is given, a paid bill is kept for history.
-- ---------------------------------------------------------------------------
create or replace function public.record_stock_purchase(
  p_business_id uuid,
  p_lines jsonb,
  p_txn_date date,
  p_idempotency_key uuid,
  p_supplier_id uuid default null,
  p_payment_method public.payment_method default 'cash',
  p_financial_account_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_source public.txn_source default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_account uuid;
  v_total bigint := 0;
  v_line record;
  v_bill uuid;
  v_supplier_name text;
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['inventory_purchase']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;
  perform private.require_valid_date(p_txn_date);

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one product to the purchase' using errcode = 'P0001';
  end if;
  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(product_id uuid, quantity integer, unit_cost_minor bigint)
  loop
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'Each line needs a quantity greater than zero' using errcode = 'P0001';
    end if;
    if v_line.unit_cost_minor is null or v_line.unit_cost_minor < 0 then
      raise exception 'Each line needs a cost of zero or more' using errcode = 'P0001';
    end if;
    if v_line.product_id is null or not exists (
      select 1 from public.products where id = v_line.product_id and business_id = p_business_id and archived_at is null
    ) then
      raise exception 'Each line needs a valid, active product' using errcode = 'P0001';
    end if;
    v_total := v_total + v_line.quantity::bigint * v_line.unit_cost_minor;
  end loop;
  perform private.require_positive(v_total, 'Purchase total');

  if p_supplier_id is not null then
    select name into v_supplier_name from public.suppliers where id = p_supplier_id and business_id = p_business_id;
    if v_supplier_name is null then
      raise exception 'Supplier not found' using errcode = 'P0001';
    end if;
  end if;

  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
  v_txn := private.insert_txn(p_business_id, 'inventory_purchase', p_txn_date,
                              'Stock purchase' || coalesce(' from ' || v_supplier_name, ''),
                              v_total, p_idempotency_key, p_source, p_payment_method, v_account,
                              null, p_supplier_id, 'Stock purchases', p_reference, p_notes);

  for v_line in
    select * from jsonb_to_recordset(p_lines) as x(product_id uuid, quantity integer, unit_cost_minor bigint)
     order by x.product_id
  loop
    perform private.stock_in(p_business_id, v_line.product_id, v_line.quantity,
                             v_line.quantity::bigint * v_line.unit_cost_minor, v_txn, p_txn_date, 'purchase', null, true);
  end loop;
  perform private.post_line(p_business_id, v_txn, 'inventory', v_total, p_txn_date);
  perform private.post_line(p_business_id, v_txn, 'cash', -v_total, p_txn_date, v_account);

  if p_supplier_id is not null then
    insert into public.bills (business_id, bill_number, supplier_reference, kind, supplier_id, transaction_id,
                              bill_date, due_date, total_minor, amount_paid_minor, status, notes, idempotency_key, created_by)
    values (p_business_id, private.next_document_number(p_business_id, 'bill'), private.clean_text(p_reference, 80),
            'inventory', p_supplier_id, v_txn, p_txn_date, p_txn_date, v_total, v_total, 'paid',
            private.clean_text(p_notes), p_idempotency_key, auth.uid())
    returning id into v_bill;
    insert into public.bill_lines (business_id, bill_id, product_id, description, quantity, unit_cost_minor, line_total_minor)
    select p_business_id, v_bill, x.product_id, p.name, x.quantity, x.unit_cost_minor, x.quantity::bigint * x.unit_cost_minor
      from jsonb_to_recordset(p_lines) as x(product_id uuid, quantity integer, unit_cost_minor bigint)
      join public.products p on p.id = x.product_id;
  end if;

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'inventory_purchase', 'amount_minor', v_total));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Supplier payment against open bills (specific bill, or oldest first).
-- ---------------------------------------------------------------------------
create or replace function public.record_supplier_payment(
  p_business_id uuid,
  p_supplier_id uuid,
  p_amount_minor bigint,
  p_payment_date date,
  p_idempotency_key uuid,
  p_payment_method public.payment_method default 'cash',
  p_financial_account_id uuid default null,
  p_bill_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_source public.txn_source default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_payment uuid;
  v_account uuid;
  v_name text;
  v_owed bigint;
  v_remaining bigint;
  v_apply bigint;
  v_bill record;
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['supplier_payment']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  perform private.require_positive(p_amount_minor, 'Payment amount');
  perform private.require_valid_date(p_payment_date);

  select name into v_name from public.suppliers where id = p_supplier_id and business_id = p_business_id;
  if v_name is null then
    raise exception 'Supplier not found' using errcode = 'P0001';
  end if;
  if p_bill_id is not null and not exists (
    select 1 from public.bills where id = p_bill_id and business_id = p_business_id and supplier_id = p_supplier_id
  ) then
    raise exception 'That bill does not belong to this supplier' using errcode = 'P0001';
  end if;

  perform 1 from public.bills
   where business_id = p_business_id and supplier_id = p_supplier_id
     and status in ('open', 'partially_paid') and (p_bill_id is null or id = p_bill_id)
   order by due_date, bill_date, id
   for update;

  select coalesce(sum(total_minor - amount_paid_minor), 0) into v_owed
    from public.bills
   where business_id = p_business_id and supplier_id = p_supplier_id
     and status in ('open', 'partially_paid') and (p_bill_id is null or id = p_bill_id);

  if v_owed = 0 then
    raise exception 'There are no unpaid bills from % to pay', v_name using errcode = 'P0001';
  end if;
  if p_amount_minor > v_owed then
    raise exception 'This payment is more than the % owed to %. Record only the amount owed.', private.fmt_money(v_owed), v_name
      using errcode = 'P0001';
  end if;

  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
  v_txn := private.insert_txn(p_business_id, 'supplier_payment', p_payment_date, 'Payment to ' || v_name,
                              p_amount_minor, p_idempotency_key, p_source, p_payment_method, v_account,
                              null, p_supplier_id, null, p_reference, p_notes);

  perform private.post_line(p_business_id, v_txn, 'accounts_payable', p_amount_minor, p_payment_date, null, null, p_supplier_id);
  perform private.post_line(p_business_id, v_txn, 'cash', -p_amount_minor, p_payment_date, v_account);

  insert into public.payments (business_id, direction, transaction_id, supplier_id, amount_minor,
                               payment_date, method, financial_account_id)
  values (p_business_id, 'out', v_txn, p_supplier_id, p_amount_minor, p_payment_date, p_payment_method, v_account)
  returning id into v_payment;

  v_remaining := p_amount_minor;
  for v_bill in
    select id, total_minor - amount_paid_minor as outstanding
      from public.bills
     where business_id = p_business_id and supplier_id = p_supplier_id
       and status in ('open', 'partially_paid') and (p_bill_id is null or id = p_bill_id)
     order by due_date, bill_date, id
  loop
    exit when v_remaining = 0;
    v_apply := least(v_remaining, v_bill.outstanding);
    continue when v_apply = 0;
    insert into public.payment_allocations (business_id, payment_id, bill_id, amount_minor)
    values (p_business_id, v_payment, v_bill.id, v_apply);
    update public.bills set amount_paid_minor = amount_paid_minor + v_apply where id = v_bill.id;
    perform private.refresh_bill_status(v_bill.id);
    v_remaining := v_remaining - v_apply;
  end loop;

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'supplier_payment', 'amount_minor', p_amount_minor, 'supplier_id', p_supplier_id));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operating expense paid now. Optionally settles a planned payment occurrence.
-- ---------------------------------------------------------------------------
create or replace function public.record_expense(
  p_business_id uuid,
  p_category text,
  p_amount_minor bigint,
  p_txn_date date,
  p_description text,
  p_idempotency_key uuid,
  p_payment_method public.payment_method default 'cash',
  p_financial_account_id uuid default null,
  p_supplier_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_scheduled_event_id uuid default null,
  p_occurrence_date date default null,
  p_source public.txn_source default 'manual',
  p_import_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_account uuid;
  v_category text := coalesce(private.clean_text(p_category, 60), 'Other');
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['operating_expense']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  perform private.require_positive(p_amount_minor, 'Expense amount');
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id and business_id = p_business_id
  ) then
    raise exception 'Supplier not found' using errcode = 'P0001';
  end if;

  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
  v_txn := private.insert_txn(p_business_id, 'operating_expense', p_txn_date,
                              coalesce(private.clean_text(p_description, 200), v_category),
                              p_amount_minor, p_idempotency_key, p_source, p_payment_method, v_account,
                              null, p_supplier_id, v_category, p_reference, p_notes, p_import_fingerprint);
  perform private.post_line(p_business_id, v_txn, 'operating_expense', p_amount_minor, p_txn_date,
                            null, null, p_supplier_id, null, v_category);
  perform private.post_line(p_business_id, v_txn, 'cash', -p_amount_minor, p_txn_date, v_account);
  perform private.settle_scheduled(p_business_id, p_scheduled_event_id, p_occurrence_date, v_txn);

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'operating_expense', 'amount_minor', p_amount_minor, 'category', v_category));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------
create or replace function public.record_loan(
  p_business_id uuid,
  p_lender text,
  p_amount_minor bigint,
  p_txn_date date,
  p_idempotency_key uuid,
  p_payment_method public.payment_method default 'bank_transfer',
  p_financial_account_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_loan uuid;
  v_account uuid;
  v_lender text;
begin
  perform private.assert_member(p_business_id, array['owner','manager']::public.business_role[]);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['loan_proceeds']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  perform private.require_positive(p_amount_minor, 'Loan amount');
  perform private.require_valid_date(p_txn_date);
  v_lender := private.require_text(p_lender, 'Lender', 120);
  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);

  insert into public.loans (business_id, lender, principal_minor, received_date, notes)
  values (p_business_id, v_lender, p_amount_minor, p_txn_date, private.clean_text(p_notes))
  returning id into v_loan;

  v_txn := private.insert_txn(p_business_id, 'loan_proceeds', p_txn_date, 'Loan from ' || v_lender,
                              p_amount_minor, p_idempotency_key, 'manual', p_payment_method, v_account,
                              null, null, 'Loans', null, p_notes);
  perform private.post_line(p_business_id, v_txn, 'cash', p_amount_minor, p_txn_date, v_account);
  perform private.post_line(p_business_id, v_txn, 'loans_payable', -p_amount_minor, p_txn_date, null, null, null, v_loan);

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'loan_proceeds', 'amount_minor', p_amount_minor, 'loan_id', v_loan));
  return private.txn_result(v_txn, false) || jsonb_build_object('loan_id', v_loan);
end;
$$;

create or replace function public.record_loan_repayment(
  p_business_id uuid,
  p_loan_id uuid,
  p_principal_minor bigint,
  p_interest_minor bigint,
  p_txn_date date,
  p_idempotency_key uuid,
  p_payment_method public.payment_method default 'bank_transfer',
  p_financial_account_id uuid default null,
  p_notes text default null,
  p_scheduled_event_id uuid default null,
  p_occurrence_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_account uuid;
  v_lender text;
  v_outstanding bigint;
  v_principal bigint := coalesce(p_principal_minor, 0);
  v_interest bigint := coalesce(p_interest_minor, 0);
begin
  perform private.assert_member(p_business_id, array['owner','manager']::public.business_role[]);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['loan_repayment']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  if v_principal < 0 or v_interest < 0 then
    raise exception 'Principal and interest cannot be negative' using errcode = 'P0001';
  end if;
  perform private.require_positive(v_principal + v_interest, 'Repayment amount');

  select lender into v_lender from public.loans where id = p_loan_id and business_id = p_business_id;
  if v_lender is null then
    raise exception 'Loan not found' using errcode = 'P0001';
  end if;
  v_outstanding := private.loan_outstanding(p_business_id, p_loan_id);
  if v_principal > v_outstanding then
    raise exception 'Principal repaid (%) is more than the % still owed on this loan', private.fmt_money(v_principal), private.fmt_money(v_outstanding)
      using errcode = 'P0001';
  end if;

  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
  v_txn := private.insert_txn(p_business_id, 'loan_repayment', p_txn_date, 'Loan repayment to ' || v_lender,
                              v_principal + v_interest, p_idempotency_key, 'manual', p_payment_method, v_account,
                              null, null, 'Loans', null, p_notes);
  perform private.post_line(p_business_id, v_txn, 'loans_payable', v_principal, p_txn_date, null, null, null, p_loan_id);
  perform private.post_line(p_business_id, v_txn, 'interest_expense', v_interest, p_txn_date, p_category => 'Loan interest');
  perform private.post_line(p_business_id, v_txn, 'cash', -(v_principal + v_interest), p_txn_date, v_account);
  perform private.settle_scheduled(p_business_id, p_scheduled_event_id, p_occurrence_date, v_txn);

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'loan_repayment', 'principal_minor', v_principal, 'interest_minor', v_interest));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner money in / out
-- ---------------------------------------------------------------------------
create or replace function public.record_owner_transaction(
  p_business_id uuid,
  p_direction text,
  p_amount_minor bigint,
  p_txn_date date,
  p_idempotency_key uuid,
  p_payment_method public.payment_method default 'cash',
  p_financial_account_id uuid default null,
  p_description text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_account uuid;
  v_type public.txn_type;
  v_sign integer;
begin
  perform private.assert_member(p_business_id, array['owner','manager']::public.business_role[]);
  if p_direction not in ('in', 'out') then
    raise exception 'Direction must be in or out' using errcode = 'P0001';
  end if;
  v_type := case p_direction when 'in' then 'owner_contribution' else 'owner_withdrawal' end::public.txn_type;
  v_sign := case p_direction when 'in' then 1 else -1 end;

  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array[v_type]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  perform private.require_positive(p_amount_minor, 'Amount');
  v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
  v_txn := private.insert_txn(p_business_id, v_type, p_txn_date,
                              coalesce(private.clean_text(p_description, 200),
                                       case p_direction when 'in' then 'Owner added money' else 'Owner took money out' end),
                              p_amount_minor, p_idempotency_key, 'manual', p_payment_method, v_account,
                              null, null, 'Owner', null, p_notes);
  perform private.post_line(p_business_id, v_txn, 'cash', v_sign * p_amount_minor, p_txn_date, v_account);
  perform private.post_line(p_business_id, v_txn, 'owner_equity', -v_sign * p_amount_minor, p_txn_date);

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', v_type, 'amount_minor', p_amount_minor));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfer between the business's own money accounts.
-- ---------------------------------------------------------------------------
create or replace function public.record_transfer(
  p_business_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_minor bigint,
  p_txn_date date,
  p_idempotency_key uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_from uuid;
  v_to uuid;
  v_from_name text;
  v_to_name text;
begin
  perform private.assert_member(p_business_id);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['transfer']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  perform private.require_positive(p_amount_minor, 'Transfer amount');
  if p_from_account_id is null or p_to_account_id is null then
    raise exception 'Choose both money accounts' using errcode = 'P0001';
  end if;
  if p_from_account_id = p_to_account_id then
    raise exception 'Choose two different money accounts' using errcode = 'P0001';
  end if;
  v_from := private.resolve_money_account(p_business_id, p_from_account_id, null);
  v_to := private.resolve_money_account(p_business_id, p_to_account_id, null);
  select name into v_from_name from public.financial_accounts where id = v_from;
  select name into v_to_name from public.financial_accounts where id = v_to;

  v_txn := private.insert_txn(p_business_id, 'transfer', p_txn_date, 'Transfer ' || v_from_name || ' → ' || v_to_name,
                              p_amount_minor, p_idempotency_key, 'manual', null, v_from, null, null, 'Transfer', null, p_notes);
  perform private.post_line(p_business_id, v_txn, 'cash', p_amount_minor, p_txn_date, v_to);
  perform private.post_line(p_business_id, v_txn, 'cash', -p_amount_minor, p_txn_date, v_from);

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'transfer', 'amount_minor', p_amount_minor, 'from', v_from, 'to', v_to));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock adjustment (counted stock differs from records; damage; found stock).
-- Losses are valued at average cost. Gains use p_unit_cost_minor, falling back
-- to the current average or last known cost.
-- ---------------------------------------------------------------------------
create or replace function public.record_stock_adjustment(
  p_business_id uuid,
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text,
  p_txn_date date,
  p_idempotency_key uuid,
  p_unit_cost_minor bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_product record;
  v_value bigint;
  v_unit bigint;
begin
  perform private.assert_member(p_business_id, array['owner','manager']::public.business_role[]);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['stock_adjustment']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Enter how many units to add or remove' using errcode = 'P0001';
  end if;
  select id, name, quantity_on_hand, inventory_value_minor, last_unit_cost_minor
    into v_product
    from public.products where id = p_product_id and business_id = p_business_id;
  if v_product.id is null then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;

  v_txn := private.insert_txn(p_business_id, 'stock_adjustment', p_txn_date,
                              'Stock adjustment: ' || v_product.name, 0, p_idempotency_key,
                              p_category => 'Stock adjustment',
                              p_notes => private.require_text(p_reason, 'Reason', 500));

  if p_quantity_delta < 0 then
    v_value := private.stock_out(p_business_id, p_product_id, -p_quantity_delta, v_txn, p_txn_date, 'adjustment', p_reason);
    perform private.post_line(p_business_id, v_txn, 'inventory_adjustment', v_value, p_txn_date, p_category => 'Stock loss');
    perform private.post_line(p_business_id, v_txn, 'inventory', -v_value, p_txn_date);
  else
    if p_unit_cost_minor is not null and p_unit_cost_minor < 0 then
      raise exception 'Unit cost cannot be negative' using errcode = 'P0001';
    end if;
    v_unit := coalesce(
      p_unit_cost_minor,
      case when v_product.quantity_on_hand > 0
           then round(v_product.inventory_value_minor::numeric / v_product.quantity_on_hand)::bigint end,
      v_product.last_unit_cost_minor,
      0);
    v_value := v_unit * p_quantity_delta;
    perform private.stock_in(p_business_id, p_product_id, p_quantity_delta, v_value, v_txn, p_txn_date, 'adjustment', p_reason);
    perform private.post_line(p_business_id, v_txn, 'inventory', v_value, p_txn_date);
    perform private.post_line(p_business_id, v_txn, 'inventory_adjustment', -v_value, p_txn_date, p_category => 'Stock gain');
  end if;

  update public.transactions set amount_minor = abs(v_value) where id = v_txn;
  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'stock_adjustment', 'product_id', p_product_id, 'quantity_delta', p_quantity_delta, 'value_minor', v_value));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refund / sales return against an invoice.
-- p_lines: [{"invoice_line_id": uuid, "quantity": int}]
-- The refund first reduces anything the customer still owes on the invoice
-- (credit note); the rest is paid back in cash.
-- ---------------------------------------------------------------------------
create or replace function public.record_refund(
  p_business_id uuid,
  p_invoice_id uuid,
  p_lines jsonb,
  p_restock boolean,
  p_txn_date date,
  p_reason text,
  p_idempotency_key uuid,
  p_payment_method public.payment_method default 'cash',
  p_financial_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_txn uuid;
  v_inv record;
  v_line record;
  v_il record;
  v_refund bigint := 0;
  v_outstanding bigint;
  v_credit_part bigint;
  v_cash_part bigint;
  v_account uuid;
  v_cost_back bigint;
  v_total_cost_back bigint := 0;
begin
  perform private.assert_member(p_business_id, array['owner','manager']::public.business_role[]);
  v_txn := private.find_idempotent(p_business_id, p_idempotency_key, array['refund']::public.txn_type[]);
  if v_txn is not null then return private.txn_result(v_txn, true); end if;
  perform private.require_valid_date(p_txn_date);

  select * into v_inv from public.invoices where id = p_invoice_id and business_id = p_business_id for update;
  if v_inv.id is null then
    raise exception 'Invoice not found' using errcode = 'P0001';
  end if;
  if v_inv.status = 'void' then
    raise exception 'This sale was voided and cannot be refunded' using errcode = 'P0001';
  end if;
  if p_txn_date < v_inv.issue_date then
    raise exception 'A refund cannot be dated before the sale' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one item to refund' using errcode = 'P0001';
  end if;

  -- Validate and price the refund.
  for v_line in select * from jsonb_to_recordset(p_lines) as x(invoice_line_id uuid, quantity integer)
  loop
    select * into v_il from public.invoice_lines
     where id = v_line.invoice_line_id and invoice_id = p_invoice_id for update;
    if v_il.id is null then
      raise exception 'Refund item does not belong to this sale' using errcode = 'P0001';
    end if;
    if v_line.quantity is null or v_line.quantity <= 0 then
      raise exception 'Refund quantity must be greater than zero' using errcode = 'P0001';
    end if;
    if v_il.refunded_quantity + v_line.quantity > v_il.quantity then
      raise exception 'Cannot refund more of "%" than was sold', v_il.description using errcode = 'P0001';
    end if;
    v_refund := v_refund + v_line.quantity::bigint * v_il.unit_price_minor;
  end loop;
  perform private.require_positive(v_refund, 'Refund amount');

  v_outstanding := v_inv.total_minor - v_inv.amount_paid_minor - v_inv.amount_credited_minor;
  v_credit_part := least(v_refund, v_outstanding);
  v_cash_part := v_refund - v_credit_part;
  if v_cash_part > v_inv.amount_paid_minor then
    raise exception 'Refund is larger than what was paid on this sale' using errcode = 'P0001';
  end if;
  if v_cash_part > 0 then
    v_account := private.resolve_money_account(p_business_id, p_financial_account_id, p_payment_method);
  end if;

  v_txn := private.insert_txn(p_business_id, 'refund', p_txn_date, 'Refund on ' || v_inv.invoice_number,
                              v_refund, p_idempotency_key, 'manual',
                              case when v_cash_part > 0 then p_payment_method end, v_account,
                              v_inv.customer_id, null, 'Refunds', v_inv.invoice_number,
                              private.require_text(p_reason, 'Reason', 500));

  perform private.post_line(p_business_id, v_txn, 'sales_returns', v_refund, p_txn_date, null, v_inv.customer_id, p_category => 'Refunds');
  perform private.post_line(p_business_id, v_txn, 'accounts_receivable', -v_credit_part, p_txn_date, null, v_inv.customer_id);
  perform private.post_line(p_business_id, v_txn, 'cash', -v_cash_part, p_txn_date, v_account);

  for v_line in
    select x.*, il.product_id, il.cost_minor, il.quantity as sold_qty, il.refunded_quantity
      from jsonb_to_recordset(p_lines) as x(invoice_line_id uuid, quantity integer)
      join public.invoice_lines il on il.id = x.invoice_line_id
     order by il.product_id nulls last, x.invoice_line_id
  loop
    -- Proportional cost of the returned units, computed cumulatively so
    -- repeated partial refunds never drift from the original cost.
    v_cost_back := round(v_line.cost_minor::numeric * (v_line.refunded_quantity + v_line.quantity) / v_line.sold_qty)::bigint
                 - round(v_line.cost_minor::numeric * v_line.refunded_quantity / v_line.sold_qty)::bigint;
    update public.invoice_lines set refunded_quantity = refunded_quantity + v_line.quantity
     where id = v_line.invoice_line_id;
    if p_restock and v_line.product_id is not null then
      perform private.stock_in(p_business_id, v_line.product_id, v_line.quantity, v_cost_back, v_txn, p_txn_date, 'return', p_reason);
      v_total_cost_back := v_total_cost_back + v_cost_back;
    end if;
  end loop;

  perform private.post_line(p_business_id, v_txn, 'inventory', v_total_cost_back, p_txn_date);
  perform private.post_line(p_business_id, v_txn, 'cogs', -v_total_cost_back, p_txn_date);

  update public.invoices
     set amount_credited_minor = amount_credited_minor + v_refund,
         amount_paid_minor = amount_paid_minor - v_cash_part
   where id = p_invoice_id;
  perform private.refresh_invoice_status(p_invoice_id);

  perform private.audit(p_business_id, 'post', 'transaction', v_txn,
    jsonb_build_object('type', 'refund', 'invoice_id', p_invoice_id, 'amount_minor', v_refund,
                       'credit_minor', v_credit_part, 'cash_minor', v_cash_part, 'restock', p_restock));
  return private.txn_result(v_txn, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Edit non-financial details. Amounts, dates and accounts are corrected by
-- voiding and re-entering, which keeps the audit trail honest.
-- ---------------------------------------------------------------------------
create or replace function public.update_transaction_details(
  p_business_id uuid,
  p_transaction_id uuid,
  p_description text,
  p_reference text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  perform private.assert_member(p_business_id);
  select jsonb_build_object('description', description, 'reference', reference, 'notes', notes)
    into v_before
    from public.transactions
   where id = p_transaction_id and business_id = p_business_id
   for update;
  if v_before is null then
    raise exception 'Transaction not found' using errcode = 'P0001';
  end if;

  update public.transactions
     set description = private.require_text(p_description, 'Description'),
         reference = private.clean_text(p_reference, 80),
         notes = private.clean_text(p_notes, 1000)
   where id = p_transaction_id;

  perform private.audit(p_business_id, 'edit_details', 'transaction', p_transaction_id,
    jsonb_build_object('before', v_before,
                       'after', jsonb_build_object('description', p_description, 'reference', p_reference, 'notes', p_notes)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Void by reversal. The original stays visible, marked voided, and a
-- void_reversal transaction with exactly opposite ledger lines is posted on
-- the original date so historical reports exclude the mistake.
-- ---------------------------------------------------------------------------
create or replace function public.void_transaction(
  p_business_id uuid,
  p_transaction_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_t record;
  v_rev uuid;
  v_mv record;
  v_removed bigint;
  v_alloc record;
  v_invoice record;
  v_bill record;
  v_reason text;
begin
  v_uid := private.assert_member(p_business_id, array['owner','manager']::public.business_role[]);
  v_reason := private.require_text(p_reason, 'Reason for voiding', 500);

  select * into v_t from public.transactions
   where id = p_transaction_id and business_id = p_business_id
   for update;
  if v_t.id is null then
    raise exception 'Transaction not found' using errcode = 'P0001';
  end if;

  -- Idempotent replay.
  if v_t.status = 'voided' then
    if exists (select 1 from public.transactions where id = v_t.reversed_by and idempotency_key = p_idempotency_key) then
      return jsonb_build_object('transaction_id', p_transaction_id, 'reversal_id', v_t.reversed_by, 'replayed', true);
    end if;
    raise exception 'This transaction is already voided' using errcode = 'P0001';
  end if;

  if v_t.type in ('void_reversal', 'refund') then
    raise exception 'This kind of record cannot be voided. Record a correcting entry instead.' using errcode = 'P0001';
  end if;

  -- Type-specific preconditions and document updates.
  if v_t.type in ('cash_sale', 'credit_sale') then
    select * into v_invoice from public.invoices where transaction_id = v_t.id for update;
    if v_invoice.amount_credited_minor > 0 then
      raise exception 'This sale has refunds recorded against it and cannot be voided' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id
       where a.invoice_id = v_invoice.id and p.voided_at is null
    ) then
      raise exception 'Void the customer payments on % first', v_invoice.invoice_number using errcode = 'P0001';
    end if;
    update public.invoices set status = 'void' where id = v_invoice.id;

  elsif v_t.type = 'customer_payment' then
    for v_alloc in
      select a.invoice_id, a.amount_minor from public.payment_allocations a
        join public.payments p on p.id = a.payment_id
       where p.transaction_id = v_t.id
    loop
      update public.invoices set amount_paid_minor = amount_paid_minor - v_alloc.amount_minor where id = v_alloc.invoice_id;
      perform private.refresh_invoice_status(v_alloc.invoice_id);
    end loop;
    update public.payments set voided_at = now() where transaction_id = v_t.id;

  elsif v_t.type = 'supplier_payment' then
    for v_alloc in
      select a.bill_id, a.amount_minor from public.payment_allocations a
        join public.payments p on p.id = a.payment_id
       where p.transaction_id = v_t.id
    loop
      update public.bills set amount_paid_minor = amount_paid_minor - v_alloc.amount_minor where id = v_alloc.bill_id;
      perform private.refresh_bill_status(v_alloc.bill_id);
    end loop;
    update public.payments set voided_at = now() where transaction_id = v_t.id;

  elsif v_t.type in ('supplier_bill', 'inventory_purchase') then
    select * into v_bill from public.bills where transaction_id = v_t.id for update;
    if v_bill.id is not null then
      if exists (
        select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id
         where a.bill_id = v_bill.id and p.voided_at is null
      ) then
        raise exception 'Void the payments on % first', v_bill.bill_number using errcode = 'P0001';
      end if;
      update public.bills set status = 'void' where id = v_bill.id;
    end if;

  elsif v_t.type = 'loan_proceeds' then
    if exists (
      select 1 from public.ledger_entries le join public.transactions t2 on t2.id = le.transaction_id
       where le.loan_id in (select loan_id from public.ledger_entries where transaction_id = v_t.id and loan_id is not null)
         and t2.type = 'loan_repayment' and t2.status = 'posted'
    ) then
      raise exception 'Void the repayments on this loan first' using errcode = 'P0001';
    end if;
  end if;

  -- Reversal header.
  v_rev := private.insert_txn(p_business_id, 'void_reversal', v_t.txn_date, left('Void: ' || v_t.description, 200),
                              v_t.amount_minor, p_idempotency_key, 'manual', v_t.payment_method,
                              v_t.financial_account_id, v_t.customer_id, v_t.supplier_id, v_t.category,
                              v_t.reference, v_reason);
  update public.transactions set reversal_of = v_t.id where id = v_rev;

  -- Exactly opposite ledger lines.
  insert into public.ledger_entries (business_id, transaction_id, account, amount_minor, entry_date,
                                     financial_account_id, customer_id, supplier_id, loan_id, category)
  select business_id, v_rev, account, -amount_minor, entry_date,
         financial_account_id, customer_id, supplier_id, loan_id, category
    from public.ledger_entries
   where transaction_id = v_t.id;

  -- Reverse stock movements. Stock that went out comes back at the exact
  -- value removed; stock that came in is removed, with any cost-pool
  -- difference posted to inventory_adjustment so the ledger stays exact.
  for v_mv in
    select * from public.inventory_movements where transaction_id = v_t.id order by product_id, id
  loop
    if v_mv.quantity_delta < 0 then
      perform private.stock_in(p_business_id, v_mv.product_id, -v_mv.quantity_delta, -v_mv.value_delta_minor,
                               v_rev, v_t.txn_date, 'void_reversal', 'Reversal of voided record');
    else
      v_removed := private.stock_remove_added(p_business_id, v_mv.product_id, v_mv.quantity_delta,
                                              v_mv.value_delta_minor, v_rev, v_t.txn_date);
      if v_removed <> v_mv.value_delta_minor then
        perform private.post_line(p_business_id, v_rev, 'inventory', v_mv.value_delta_minor - v_removed, v_t.txn_date);
        perform private.post_line(p_business_id, v_rev, 'inventory_adjustment', v_removed - v_mv.value_delta_minor,
                                  v_t.txn_date, p_category => 'Costing correction');
      end if;
    end if;
  end loop;

  delete from public.scheduled_event_settlements where transaction_id = v_t.id;

  update public.transactions
     set status = 'voided', voided_at = now(), voided_by = v_uid, void_reason = v_reason, reversed_by = v_rev
   where id = v_t.id;

  perform private.audit(p_business_id, 'void', 'transaction', v_t.id,
    jsonb_build_object('reason', v_reason, 'reversal_id', v_rev, 'type', v_t.type, 'amount_minor', v_t.amount_minor));
  return jsonb_build_object('transaction_id', v_t.id, 'reversal_id', v_rev, 'replayed', false);
end;
$$;
