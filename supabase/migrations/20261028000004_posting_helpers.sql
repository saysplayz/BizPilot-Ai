-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0004 Internal posting helpers (private schema, not exposed)
-- =============================================================================

-- Errors raised for business-rule violations use SQLSTATE P0001 with a
-- message written for shop owners; the app shows the message as-is.

-- ---------------------------------------------------------------------------
-- Idempotency: returns the existing transaction for this key, or null.
-- A replay with a different transaction type is treated as a client bug.
-- ---------------------------------------------------------------------------
create or replace function private.find_idempotent(
  p_business_id uuid, p_key uuid, p_types public.txn_type[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_type public.txn_type;
begin
  if p_key is null then
    raise exception 'An idempotency key is required' using errcode = '22023';
  end if;
  select id, type into v_id, v_type
    from public.transactions
   where business_id = p_business_id and idempotency_key = p_key;
  if v_id is not null and not (v_type = any (p_types)) then
    raise exception 'This request key was already used for a different kind of record'
      using errcode = '22023';
  end if;
  return v_id;
end;
$$;

create or replace function private.txn_result(p_txn_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'transaction_id', t.id,
    'type', t.type,
    'replayed', p_replayed,
    'invoice_id', (select i.id from public.invoices i where i.transaction_id = t.id limit 1),
    'bill_id', (select b.id from public.bills b where b.transaction_id = t.id limit 1),
    'payment_id', (select p.id from public.payments p where p.transaction_id = t.id limit 1)
  ))
  from public.transactions t where t.id = p_txn_id;
$$;

-- ---------------------------------------------------------------------------
-- Validation helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_positive(p_amount bigint, p_label text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '% must be greater than zero', p_label using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.require_valid_date(p_date date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_date is null then
    raise exception 'A date is required' using errcode = 'P0001';
  end if;
  if p_date < date '2000-01-01' or p_date > current_date + 366 then
    raise exception 'The date % is outside the allowed range', p_date using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.require_text(p_value text, p_label text, p_max integer default 200)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if v = '' then
    raise exception '% is required', p_label using errcode = 'P0001';
  end if;
  if char_length(v) > p_max then
    raise exception '% is too long (max % characters)', p_label, p_max using errcode = 'P0001';
  end if;
  return v;
end;
$$;

create or replace function private.clean_text(p_value text, p_max integer default 1000)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce(p_value, '')), p_max), '');
$$;

-- Human-readable money for error messages (GH₵1,234.50).
create or replace function private.fmt_money(p_minor bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_minor < 0 then '-' else '' end || 'GH₵'
         || to_char(abs(p_minor)::numeric / 100, 'FM999,999,999,999,990.00');
$$;

-- ---------------------------------------------------------------------------
-- Resolve which money account a cash movement uses. An explicit account wins;
-- otherwise the payment method picks the first matching account kind, then
-- the business default.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_money_account(
  p_business_id uuid, p_account_id uuid, p_method public.payment_method
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind public.money_account_kind;
begin
  if p_account_id is not null then
    select id into v_id from public.financial_accounts
     where id = p_account_id and business_id = p_business_id and archived_at is null;
    if v_id is null then
      raise exception 'That money account does not exist or is archived' using errcode = 'P0001';
    end if;
    return v_id;
  end if;

  v_kind := case p_method
              when 'cash' then 'cash'
              when 'mobile_money' then 'mobile_money'
              when 'bank_transfer' then 'bank'
              when 'card' then 'bank'
              else null
            end::public.money_account_kind;

  if v_kind is not null then
    select id into v_id from public.financial_accounts
     where business_id = p_business_id and kind = v_kind and archived_at is null
     order by is_default desc, created_at
     limit 1;
  end if;

  if v_id is null then
    select id into v_id from public.financial_accounts
     where business_id = p_business_id and archived_at is null
     order by is_default desc, created_at
     limit 1;
  end if;

  if v_id is null then
    raise exception 'Add a money account (for example Cash) before recording money movements'
      using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Insert a transaction header.
-- ---------------------------------------------------------------------------
create or replace function private.insert_txn(
  p_business_id uuid,
  p_type public.txn_type,
  p_date date,
  p_description text,
  p_amount bigint,
  p_key uuid,
  p_source public.txn_source default 'manual',
  p_method public.payment_method default null,
  p_account_id uuid default null,
  p_customer_id uuid default null,
  p_supplier_id uuid default null,
  p_category text default null,
  p_reference text default null,
  p_notes text default null,
  p_import_fingerprint text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_valid_date(p_date);
  insert into public.transactions (
    business_id, type, txn_date, description, amount_minor, idempotency_key, source,
    payment_method, financial_account_id, customer_id, supplier_id, category,
    reference, notes, import_fingerprint, created_by
  ) values (
    p_business_id, p_type, p_date, private.require_text(p_description, 'Description'),
    p_amount, p_key, coalesce(p_source, 'manual'),
    p_method, p_account_id, p_customer_id, p_supplier_id, private.clean_text(p_category, 60),
    private.clean_text(p_reference, 80), private.clean_text(p_notes, 1000),
    private.clean_text(p_import_fingerprint, 200), auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Insert one ledger line (zero amounts are skipped).
-- ---------------------------------------------------------------------------
create or replace function private.post_line(
  p_business_id uuid,
  p_txn_id uuid,
  p_account public.ledger_account,
  p_amount bigint,
  p_date date,
  p_money_account_id uuid default null,
  p_customer_id uuid default null,
  p_supplier_id uuid default null,
  p_loan_id uuid default null,
  p_category text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount is null or p_amount = 0 then
    return;
  end if;
  insert into public.ledger_entries (
    business_id, transaction_id, account, amount_minor, entry_date,
    financial_account_id, customer_id, supplier_id, loan_id, category
  ) values (
    p_business_id, p_txn_id, p_account, p_amount, p_date,
    case when p_account = 'cash' then p_money_account_id end,
    p_customer_id, p_supplier_id, p_loan_id, p_category
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventory: take stock out at weighted average cost. Returns the cost value
-- removed. Locks the product row so concurrent sales serialise correctly.
-- ---------------------------------------------------------------------------
create or replace function private.stock_out(
  p_business_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_txn_id uuid,
  p_date date,
  p_type public.inventory_movement_type,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
  v_value bigint;
  v_name text;
  v_removed bigint;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be a whole number greater than zero' using errcode = 'P0001';
  end if;

  select quantity_on_hand, inventory_value_minor, name
    into v_qty, v_value, v_name
    from public.products
   where id = p_product_id and business_id = p_business_id
   for update;

  if not found then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;

  if p_quantity > v_qty then
    raise exception 'Not enough stock for "%": % in stock, % needed. Record the stock you received or adjust the stock count first.',
      v_name, v_qty, p_quantity using errcode = 'P0001';
  end if;

  v_removed := case
                 when p_quantity = v_qty then v_value
                 else round(v_value::numeric * p_quantity / v_qty)::bigint
               end;

  update public.products
     set quantity_on_hand = v_qty - p_quantity,
         inventory_value_minor = v_value - v_removed
   where id = p_product_id;

  insert into public.inventory_movements (
    business_id, product_id, transaction_id, movement_type, movement_date,
    quantity_delta, value_delta_minor, quantity_after, value_after_minor, note
  ) values (
    p_business_id, p_product_id, p_txn_id, p_type, p_date,
    -p_quantity, -v_removed, v_qty - p_quantity, v_value - v_removed, p_note
  );

  return v_removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventory: put stock in with a known total cost value.
-- ---------------------------------------------------------------------------
create or replace function private.stock_in(
  p_business_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_value bigint,
  p_txn_id uuid,
  p_date date,
  p_type public.inventory_movement_type,
  p_note text default null,
  p_update_last_cost boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
  v_value bigint;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be a whole number greater than zero' using errcode = 'P0001';
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'Stock value cannot be negative' using errcode = 'P0001';
  end if;

  select quantity_on_hand, inventory_value_minor
    into v_qty, v_value
    from public.products
   where id = p_product_id and business_id = p_business_id
   for update;

  if not found then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;

  update public.products
     set quantity_on_hand = v_qty + p_quantity,
         inventory_value_minor = v_value + p_value,
         last_unit_cost_minor = case when p_update_last_cost
                                     then round(p_value::numeric / p_quantity)::bigint
                                     else last_unit_cost_minor end
   where id = p_product_id;

  insert into public.inventory_movements (
    business_id, product_id, transaction_id, movement_type, movement_date,
    quantity_delta, value_delta_minor, quantity_after, value_after_minor, note
  ) values (
    p_business_id, p_product_id, p_txn_id, p_type, p_date,
    p_quantity, p_value, v_qty + p_quantity, v_value + p_value, p_note
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventory: remove stock that was originally added with value p_target
-- (used when voiding purchases / opening stock / positive adjustments).
-- Removes exactly p_target when the cost pool allows it; otherwise removes
-- what keeps the pool valid. Returns the value actually removed.
-- ---------------------------------------------------------------------------
create or replace function private.stock_remove_added(
  p_business_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_target bigint,
  p_txn_id uuid,
  p_date date
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
  v_value bigint;
  v_name text;
  v_after_value bigint;
begin
  select quantity_on_hand, inventory_value_minor, name
    into v_qty, v_value, v_name
    from public.products
   where id = p_product_id and business_id = p_business_id
   for update;

  if p_quantity > v_qty then
    raise exception 'Cannot void: only % of "%" are left in stock but this record added %. Some were already sold.',
      v_qty, v_name, p_quantity using errcode = 'P0001';
  end if;

  if v_qty - p_quantity = 0 then
    v_after_value := 0;
  else
    v_after_value := greatest(v_value - p_target, 0);
  end if;

  update public.products
     set quantity_on_hand = v_qty - p_quantity,
         inventory_value_minor = v_after_value
   where id = p_product_id;

  insert into public.inventory_movements (
    business_id, product_id, transaction_id, movement_type, movement_date,
    quantity_delta, value_delta_minor, quantity_after, value_after_minor, note
  ) values (
    p_business_id, p_product_id, p_txn_id, 'void_reversal', p_date,
    -p_quantity, v_after_value - v_value, v_qty - p_quantity, v_after_value, 'Reversal of voided record'
  );

  return v_value - v_after_value;
end;
$$;

-- ---------------------------------------------------------------------------
-- Document status maintenance
-- ---------------------------------------------------------------------------
create or replace function private.refresh_invoice_status(p_invoice_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invoices
     set status = case
                    when status = 'void' then 'void'
                    when total_minor - amount_paid_minor - amount_credited_minor = 0 then 'paid'
                    when amount_paid_minor + amount_credited_minor > 0 then 'partially_paid'
                    else 'open'
                  end::public.invoice_status
   where id = p_invoice_id;
$$;

create or replace function private.refresh_bill_status(p_bill_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.bills
     set status = case
                    when status in ('void', 'draft') then status
                    when total_minor - amount_paid_minor = 0 then 'paid'
                    when amount_paid_minor > 0 then 'partially_paid'
                    else 'open'
                  end::public.bill_status
   where id = p_bill_id;
$$;

-- Outstanding amount a customer owes across open invoices.
create or replace function private.customer_outstanding(p_business_id uuid, p_customer_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(total_minor - amount_paid_minor - amount_credited_minor), 0)::bigint
    from public.invoices
   where business_id = p_business_id and customer_id = p_customer_id
     and status in ('open', 'partially_paid');
$$;

create or replace function private.supplier_outstanding(p_business_id uuid, p_supplier_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(total_minor - amount_paid_minor), 0)::bigint
    from public.bills
   where business_id = p_business_id and supplier_id = p_supplier_id
     and status in ('open', 'partially_paid');
$$;

create or replace function private.loan_outstanding(p_business_id uuid, p_loan_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(-sum(amount_minor), 0)::bigint
    from public.ledger_entries
   where business_id = p_business_id and loan_id = p_loan_id and account = 'loans_payable';
$$;

-- Settle one occurrence of a scheduled cash event with a real transaction so
-- the forecast stops counting it.
create or replace function private.settle_scheduled(
  p_business_id uuid, p_event_id uuid, p_occurrence date, p_txn_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_id is null then
    return;
  end if;
  if p_occurrence is null then
    raise exception 'Choose which date of the planned payment this settles' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.scheduled_cash_events
                  where id = p_event_id and business_id = p_business_id) then
    raise exception 'Planned payment not found' using errcode = 'P0001';
  end if;
  insert into public.scheduled_event_settlements (business_id, scheduled_event_id, occurrence_date, transaction_id)
  values (p_business_id, p_event_id, p_occurrence, p_txn_id)
  on conflict (scheduled_event_id, occurrence_date) do nothing;
end;
$$;
