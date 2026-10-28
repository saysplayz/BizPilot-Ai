-- BizPilot AI · Part 1 — Database & Security
-- Owner: Member 1 (see TEAM.md)
-- =============================================================================
-- BizPilot AI — 0003 Ledger and business documents
--
-- Accounting approach (documented in docs/ACCOUNTING.md):
--   A lightweight double-entry ledger. Every posted business event is a
--   `transactions` row with two or more `ledger_entries` whose amounts sum to
--   zero (debit = positive, credit = negative). All financial figures shown in
--   the app are sums over ledger entries, so revenue, cash, receivables, loans
--   and owner money are separated by construction rather than by UI logic.
--
--   This is an operational management ledger, NOT a statutory accounting or
--   tax-compliance system.
-- =============================================================================

create type public.ledger_account as enum (
  'cash',                    -- money in a financial_account (till, MoMo, bank)
  'accounts_receivable',     -- customers owe the business
  'inventory',               -- stock at weighted-average cost
  'accounts_payable',        -- the business owes suppliers
  'loans_payable',           -- loan principal outstanding
  'owner_equity',            -- owner contributions / withdrawals
  'opening_balance_equity',  -- balances brought in when starting to use the app
  'sales_revenue',
  'sales_returns',           -- contra-revenue (refunds)
  'cogs',                    -- cost of goods sold
  'operating_expense',
  'interest_expense',
  'inventory_adjustment'     -- stock losses/gains and costing corrections
);

create type public.txn_type as enum (
  'opening_balance',
  'cash_sale',
  'credit_sale',
  'customer_payment',
  'inventory_purchase',
  'supplier_bill',
  'operating_expense',
  'supplier_payment',
  'loan_proceeds',
  'loan_repayment',
  'owner_contribution',
  'owner_withdrawal',
  'refund',
  'transfer',
  'stock_adjustment',
  'void_reversal'
);

create type public.payment_method as enum ('cash', 'mobile_money', 'bank_transfer', 'card', 'other');
create type public.txn_status as enum ('posted', 'voided');
create type public.txn_source as enum ('manual', 'import', 'demo', 'ai_confirmed');

-- ---------------------------------------------------------------------------
-- Transactions (journal headers)
-- ---------------------------------------------------------------------------
create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  type                public.txn_type not null,
  status              public.txn_status not null default 'posted',
  txn_date            date not null,
  description         text not null check (char_length(btrim(description)) between 1 and 200),
  amount_minor        bigint not null check (amount_minor >= 0),   -- headline amount for lists
  category            text check (category is null or char_length(category) <= 60),
  payment_method      public.payment_method,
  financial_account_id uuid,
  customer_id         uuid,
  supplier_id         uuid,
  reference           text check (reference is null or char_length(reference) <= 80),
  notes               text check (notes is null or char_length(notes) <= 1000),
  source              public.txn_source not null default 'manual',
  idempotency_key     uuid not null,
  import_fingerprint  text,
  reversal_of         uuid references public.transactions (id),
  reversed_by         uuid references public.transactions (id),
  voided_at           timestamptz,
  voided_by           uuid references auth.users (id) on delete set null,
  void_reason         text check (void_reason is null or char_length(void_reason) <= 500),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, financial_account_id) references public.financial_accounts (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  constraint transactions_void_consistency check (
    (status = 'posted' and voided_at is null) or (status = 'voided' and voided_at is not null)
  )
);

create unique index transactions_import_fingerprint_uniq
  on public.transactions (business_id, import_fingerprint)
  where import_fingerprint is not null and status = 'posted';
create index transactions_business_date_idx on public.transactions (business_id, txn_date desc, created_at desc);
create index transactions_business_type_idx on public.transactions (business_id, type);
create index transactions_customer_idx on public.transactions (customer_id) where customer_id is not null;
create index transactions_supplier_idx on public.transactions (supplier_id) where supplier_id is not null;
create index transactions_search_idx on public.transactions using gin (to_tsvector('simple', description || ' ' || coalesce(reference, '')));

-- ---------------------------------------------------------------------------
-- Ledger entries (journal lines)
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id                    bigint generated always as identity primary key,
  business_id           uuid not null,
  transaction_id        uuid not null,
  account               public.ledger_account not null,
  amount_minor          bigint not null check (amount_minor <> 0),  -- debit +, credit -
  entry_date            date not null,
  financial_account_id  uuid,
  customer_id           uuid,
  supplier_id           uuid,
  loan_id               uuid,
  category              text,
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade,
  foreign key (business_id, financial_account_id) references public.financial_accounts (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, loan_id) references public.loans (business_id, id),
  constraint ledger_cash_needs_account check ((account = 'cash') = (financial_account_id is not null)),
  constraint ledger_loan_needs_loan check (account <> 'loans_payable' or loan_id is not null)
);

create index ledger_entries_business_account_date_idx on public.ledger_entries (business_id, account, entry_date);
create index ledger_entries_transaction_idx on public.ledger_entries (transaction_id);
create index ledger_entries_customer_idx on public.ledger_entries (customer_id) where customer_id is not null;
create index ledger_entries_supplier_idx on public.ledger_entries (supplier_id) where supplier_id is not null;

-- Every transaction must balance. Deferred so multi-line inserts are checked
-- once at commit, and fires per affected transaction.
create or replace function private.assert_transaction_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sum bigint;
  v_count integer;
begin
  select coalesce(sum(amount_minor), 0), count(*)
    into v_sum, v_count
    from public.ledger_entries
   where transaction_id = new.transaction_id;

  if v_count > 0 and v_count < 2 then
    raise exception 'Transaction % must have at least two ledger lines', new.transaction_id
      using errcode = '23514';
  end if;
  if v_sum <> 0 then
    raise exception 'Transaction % is unbalanced by % minor units', new.transaction_id, v_sum
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger ledger_entries_balanced
  after insert or update on public.ledger_entries
  deferrable initially deferred
  for each row execute function private.assert_transaction_balanced();

-- Ledger lines are immutable once written. Corrections are reversals.
create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable; post a reversal instead', tg_table_name
    using errcode = '42501';
end;
$$;

-- UPDATE is blocked for every role. DELETE is not granted to application
-- roles at all (see RLS migration); it only happens via ON DELETE CASCADE when
-- a whole business is erased.
create trigger ledger_entries_immutable
  before update on public.ledger_entries
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Inventory movement ledger
-- quantity_after / value_after snapshot the product right after the movement,
-- which makes reconciliation and history views cheap.
-- ---------------------------------------------------------------------------
create type public.inventory_movement_type as enum (
  'opening', 'purchase', 'sale', 'adjustment', 'return', 'void_reversal'
);

create table public.inventory_movements (
  id               bigint generated always as identity primary key,
  business_id      uuid not null,
  product_id       uuid not null,
  transaction_id   uuid not null,
  movement_type    public.inventory_movement_type not null,
  movement_date    date not null,
  quantity_delta   integer not null check (quantity_delta <> 0),
  value_delta_minor bigint not null,
  quantity_after   integer not null check (quantity_after >= 0),
  value_after_minor bigint not null check (value_after_minor >= 0),
  note             text,
  created_at       timestamptz not null default now(),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id) on delete cascade
);

create index inventory_movements_product_idx on public.inventory_movements (product_id, id);
create index inventory_movements_business_date_idx on public.inventory_movements (business_id, movement_date);

create trigger inventory_movements_immutable
  before update on public.inventory_movements
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Sales documents. Every sale (cash or credit) produces an invoice so line
-- items, refunds and history are uniform. A cash sale's invoice is paid at
-- creation.
-- ---------------------------------------------------------------------------
create type public.invoice_status as enum ('open', 'partially_paid', 'paid', 'void');

create table public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null,
  invoice_number        text not null,
  sale_kind             text not null check (sale_kind in ('cash', 'credit')),
  customer_id           uuid,
  transaction_id        uuid not null,
  issue_date            date not null,
  due_date              date not null,
  total_minor           bigint not null check (total_minor > 0),
  amount_paid_minor     bigint not null default 0 check (amount_paid_minor >= 0),
  amount_credited_minor bigint not null default 0 check (amount_credited_minor >= 0),
  status                public.invoice_status not null default 'open',
  notes                 text check (notes is null or char_length(notes) <= 1000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, invoice_number),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id),
  constraint invoices_not_overpaid check (amount_paid_minor + amount_credited_minor <= total_minor),
  constraint invoices_due_after_issue check (due_date >= issue_date),
  constraint invoices_credit_needs_customer check (sale_kind = 'cash' or customer_id is not null)
);

create index invoices_business_status_idx on public.invoices (business_id, status, due_date);
create index invoices_customer_idx on public.invoices (customer_id) where customer_id is not null;

create table public.invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,
  invoice_id          uuid not null,
  product_id          uuid,
  description         text not null check (char_length(btrim(description)) between 1 and 200),
  quantity            integer not null check (quantity > 0),
  unit_price_minor    bigint not null check (unit_price_minor >= 0),
  line_total_minor    bigint not null check (line_total_minor >= 0),
  cost_minor          bigint not null default 0 check (cost_minor >= 0),  -- COGS recognised for this line
  refunded_quantity   integer not null default 0 check (refunded_quantity >= 0),
  foreign key (business_id, invoice_id) references public.invoices (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id),
  constraint invoice_lines_total check (line_total_minor = quantity * unit_price_minor),
  constraint invoice_lines_refund_le_qty check (refunded_quantity <= quantity)
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index invoice_lines_product_idx on public.invoice_lines (product_id) where product_id is not null;

-- ---------------------------------------------------------------------------
-- Supplier bills. kind = 'inventory' (stock purchases) or 'expense' (rent,
-- utilities invoiced by a supplier). Draft bills have no transaction and do
-- not touch the ledger or stock until posted.
-- ---------------------------------------------------------------------------
create type public.bill_status as enum ('draft', 'open', 'partially_paid', 'paid', 'void');

create table public.bills (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null,
  bill_number        text not null,
  supplier_reference text check (supplier_reference is null or char_length(supplier_reference) <= 80),
  kind               text not null check (kind in ('inventory', 'expense')),
  supplier_id        uuid not null,
  transaction_id     uuid,
  bill_date          date not null,
  due_date           date not null,
  total_minor        bigint not null check (total_minor > 0),
  amount_paid_minor  bigint not null default 0 check (amount_paid_minor >= 0),
  status             public.bill_status not null default 'draft',
  category           text check (category is null or char_length(category) <= 60),
  notes              text check (notes is null or char_length(notes) <= 1000),
  idempotency_key    uuid not null,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, bill_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id),
  constraint bills_not_overpaid check (amount_paid_minor <= total_minor),
  constraint bills_due_after_bill check (due_date >= bill_date),
  constraint bills_posted_has_txn check ((status in ('draft')) = (transaction_id is null) or status = 'void')
);
create index bills_business_status_idx on public.bills (business_id, status, due_date);
create index bills_supplier_idx on public.bills (supplier_id);

create table public.bill_lines (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  bill_id          uuid not null,
  product_id       uuid,
  description      text not null check (char_length(btrim(description)) between 1 and 200),
  quantity         integer not null check (quantity > 0),
  unit_cost_minor  bigint not null check (unit_cost_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  foreign key (business_id, bill_id) references public.bills (business_id, id) on delete cascade,
  foreign key (business_id, product_id) references public.products (business_id, id),
  constraint bill_lines_total check (line_total_minor = quantity * unit_cost_minor)
);
create index bill_lines_bill_idx on public.bill_lines (bill_id);

-- ---------------------------------------------------------------------------
-- Payments and allocations (customer receipts and supplier payments).
-- An allocation ties part of a payment to one invoice or bill, which is what
-- prevents a collection from being counted as new revenue.
-- ---------------------------------------------------------------------------
create table public.payments (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null,
  direction             text not null check (direction in ('in', 'out')),
  transaction_id        uuid not null,
  customer_id           uuid,
  supplier_id           uuid,
  amount_minor          bigint not null check (amount_minor > 0),
  payment_date          date not null,
  method                public.payment_method not null,
  financial_account_id  uuid not null,
  voided_at             timestamptz,
  created_at            timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, transaction_id) references public.transactions (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, financial_account_id) references public.financial_accounts (business_id, id),
  constraint payments_party check (
    (direction = 'in' and customer_id is not null and supplier_id is null) or
    (direction = 'out' and supplier_id is not null and customer_id is null)
  )
);
create index payments_customer_idx on public.payments (customer_id) where customer_id is not null;
create index payments_supplier_idx on public.payments (supplier_id) where supplier_id is not null;

create table public.payment_allocations (
  id            bigint generated always as identity primary key,
  business_id   uuid not null,
  payment_id    uuid not null,
  invoice_id    uuid,
  bill_id       uuid,
  amount_minor  bigint not null check (amount_minor > 0),
  foreign key (business_id, payment_id) references public.payments (business_id, id) on delete cascade,
  foreign key (business_id, invoice_id) references public.invoices (business_id, id),
  foreign key (business_id, bill_id) references public.bills (business_id, id),
  constraint allocation_target check ((invoice_id is null) <> (bill_id is null))
);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id) where invoice_id is not null;
create index payment_allocations_bill_idx on public.payment_allocations (bill_id) where bill_id is not null;

-- ---------------------------------------------------------------------------
-- Planned cash events that are not (yet) invoices or bills: rent, payroll,
-- expected owner top-ups, etc. Forecast-only until actually paid; a payment
-- can settle a specific occurrence so it is never counted twice.
-- ---------------------------------------------------------------------------
create type public.forecast_confidence as enum ('confirmed', 'scheduled', 'expected', 'uncertain');

create table public.scheduled_cash_events (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  direction     text not null check (direction in ('in', 'out')),
  label         text not null check (char_length(btrim(label)) between 1 and 120),
  category      text check (category is null or char_length(category) <= 60),
  amount_minor  bigint not null check (amount_minor > 0),
  start_date    date not null,
  recurrence    text not null default 'none' check (recurrence in ('none', 'weekly', 'monthly')),
  end_date      date,
  confidence    public.forecast_confidence not null default 'scheduled'
                check (confidence <> 'confirmed'),
  active        boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (business_id, id),
  constraint scheduled_end_after_start check (end_date is null or end_date >= start_date)
);
create index scheduled_cash_events_business_idx on public.scheduled_cash_events (business_id) where active;

create table public.scheduled_event_settlements (
  business_id         uuid not null,
  scheduled_event_id  uuid not null,
  occurrence_date     date not null,
  transaction_id      uuid not null,
  created_at          timestamptz not null default now(),
  primary key (scheduled_event_id, occurrence_date),
  foreign key (business_id, scheduled_event_id) references public.scheduled_cash_events (business_id, id) on delete cascade,
  foreign key (business_id, transaction_id) references public.transactions (business_id, id)
);

create trigger invoices_touch before update on public.invoices
  for each row execute function private.touch_updated_at();
create trigger bills_touch before update on public.bills
  for each row execute function private.touch_updated_at();
