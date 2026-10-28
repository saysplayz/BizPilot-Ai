-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0002 Master data
-- Financial accounts (where money sits), customers, suppliers, products, loans,
-- per-business document counters.
-- =============================================================================

create type public.money_account_kind as enum ('cash', 'mobile_money', 'bank');

create table public.financial_accounts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  kind         public.money_account_kind not null,
  is_default   boolean not null default false,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (business_id, name),
  unique (business_id, id)
);

-- At most one default account per business.
create unique index financial_accounts_one_default
  on public.financial_accounts (business_id) where is_default;

create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 1 and 120),
  phone                text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  notes                text check (char_length(notes) <= 1000),
  credit_limit_minor   bigint check (credit_limit_minor is null or credit_limit_minor >= 0),
  payment_terms_days   integer check (payment_terms_days is null or payment_terms_days between 0 and 365),
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (business_id, id)
);
create index customers_business_name_idx on public.customers (business_id, lower(name));

create table public.suppliers (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 1 and 120),
  phone                text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  email                text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes                text check (char_length(notes) <= 1000),
  payment_terms_days   integer check (payment_terms_days is null or payment_terms_days between 0 and 365),
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (business_id, id)
);
create index suppliers_business_name_idx on public.suppliers (business_id, lower(name));

-- Products. quantity_on_hand and inventory_value_minor are maintained ONLY by
-- posting functions (column privileges block direct client updates).
-- Costing method: weighted average cost, tracked as a cost pool:
--   average unit cost = inventory_value_minor / quantity_on_hand
-- Selling k of n units removes round(value * k / n); the last unit removes the
-- whole remaining value, so the pool can never drift away from zero.
create table public.products (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  name                   text not null check (char_length(btrim(name)) between 1 and 120),
  sku                    text check (sku is null or char_length(sku) between 1 and 60),
  description            text check (char_length(description) <= 1000),
  selling_price_minor    bigint not null default 0 check (selling_price_minor >= 0),
  last_unit_cost_minor   bigint not null default 0 check (last_unit_cost_minor >= 0),
  quantity_on_hand       integer not null default 0 check (quantity_on_hand >= 0),
  inventory_value_minor  bigint not null default 0 check (inventory_value_minor >= 0),
  low_stock_threshold    integer not null default 0 check (low_stock_threshold >= 0),
  supplier_id            uuid,
  barcode                text check (barcode is null or char_length(barcode) <= 64),
  expiry_date            date,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (business_id, id),
  constraint products_empty_has_no_value check (quantity_on_hand > 0 or inventory_value_minor = 0),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id)
);
create unique index products_business_sku_uniq on public.products (business_id, lower(sku)) where sku is not null;
create index products_business_name_idx on public.products (business_id, lower(name));
create index products_low_stock_idx on public.products (business_id) where archived_at is null and quantity_on_hand <= low_stock_threshold;

create table public.loans (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  lender            text not null check (char_length(btrim(lender)) between 1 and 120),
  principal_minor   bigint not null check (principal_minor > 0),
  received_date     date not null,
  notes             text check (char_length(notes) <= 1000),
  created_at        timestamptz not null default now(),
  unique (business_id, id)
);

-- Gap-free-ish per-business numbering for invoices and bills. Rows are locked
-- with UPDATE ... RETURNING inside the posting transaction, so numbers are
-- never handed out twice.
create table public.document_counters (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  doc_type     text not null check (doc_type in ('invoice', 'bill')),
  next_value   bigint not null default 1,
  primary key (business_id, doc_type)
);

create or replace function private.next_document_number(p_business_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value bigint;
begin
  insert into public.document_counters (business_id, doc_type)
  values (p_business_id, p_doc_type)
  on conflict (business_id, doc_type) do nothing;

  update public.document_counters
     set next_value = next_value + 1
   where business_id = p_business_id and doc_type = p_doc_type
  returning next_value - 1 into v_value;

  return case p_doc_type when 'invoice' then 'INV-' else 'BILL-' end || lpad(v_value::text, 5, '0');
end;
$$;

create trigger customers_touch before update on public.customers
  for each row execute function private.touch_updated_at();
create trigger suppliers_touch before update on public.suppliers
  for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

-- Audit trail for master-data edits made directly through the API.
create or replace function private.audit_master_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit(new.business_id, 'create', tg_table_name, new.id, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    -- Stock levels change on every sale and are audited by the posting
    -- functions themselves, so they are ignored here to avoid noise.
    if to_jsonb(new) - array['updated_at','quantity_on_hand','inventory_value_minor','last_unit_cost_minor']
       is distinct from
       to_jsonb(old) - array['updated_at','quantity_on_hand','inventory_value_minor','last_unit_cost_minor'] then
      perform private.audit(new.business_id, 'update', tg_table_name, new.id,
        jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)));
    end if;
    return new;
  end if;
  return null;
end;
$$;

create trigger customers_audit after insert or update on public.customers
  for each row execute function private.audit_master_data();
create trigger suppliers_audit after insert or update on public.suppliers
  for each row execute function private.audit_master_data();
create trigger products_audit after insert or update on public.products
  for each row execute function private.audit_master_data();
create trigger financial_accounts_audit after insert or update on public.financial_accounts
  for each row execute function private.audit_master_data();
