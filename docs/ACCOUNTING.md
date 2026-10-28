# Accounting approach

BizPilot uses a **lightweight double-entry ledger**. It is an operational management tool for owners. It is **not** a statutory accounting, audit or tax-compliance system, and it doesn't handle VAT, NHIL, GETFund or income-tax reporting.

## Model

- Every business event is one `transactions` row plus two or more `ledger_entries`. Amounts are signed: **debit = positive, credit = negative**, and a deferred constraint guarantees each transaction sums to zero.
- Money is stored as **BIGINT minor units** (pesewas for GHS). No floating point is used for any authoritative figure. Rounding happens only in `src/core/money.ts` (half away from zero, matching PostgreSQL `round`) and in the cost-of-goods calculation below.
- Business dates are SQL `DATE`s interpreted in `Africa/Accra` (UTC+0, no daylight saving). Timestamps are stored in UTC.
- Ledger accounts (enum `ledger_account`): `cash` (split by money account: till, Mobile Money, bank), `accounts_receivable`, `inventory`, `accounts_payable`, `loans_payable`, `owner_equity`, `opening_balance_equity`, `sales_revenue`, `sales_returns`, `cogs`, `operating_expense` (by category), `interest_expense`, `inventory_adjustment`.
- All writes go through posting functions (`supabase/migrations/…0005_posting_functions.sql`). Each one is a single database transaction and is **idempotent**: a retried request with the same key returns the original result.

## Posting rules

| Event | Ledger lines | Notes |
|---|---|---|
| Opening cash | Dr cash · Cr opening-balance equity | not revenue |
| Opening stock | Dr inventory · Cr opening-balance equity | at the cost entered; only before other movements of that product |
| Cash sale | Dr cash · Cr sales revenue; Dr COGS · Cr inventory | stock leaves at average cost |
| Credit sale | Dr receivable · Cr sales revenue; Dr COGS · Cr inventory | **no cash** until paid |
| Customer payment | Dr cash · Cr receivable | **no new revenue**; allocated to a chosen invoice or oldest first; overpayment refused |
| Stock purchase (paid) | Dr inventory · Cr cash | not an expense; becomes COGS when sold |
| Stock on credit / expense bill | Dr inventory or expense · Cr payable | bill can be saved as a draft first (no ledger effect) |
| Supplier payment | Dr payable · Cr cash | **no second expense**; allocated to a bill or oldest first |
| Operating expense | Dr expense (category) · Cr cash | can settle a planned payment so the forecast stops counting it |
| Loan received | Dr cash · Cr loans payable | not revenue |
| Loan repayment | Dr loans payable (principal) + Dr interest expense · Cr cash | principal is not an expense |
| Owner contribution / withdrawal | Dr cash · Cr owner equity / reverse | not revenue or expense |
| Transfer between own accounts | Dr cash (to) · Cr cash (from) | no income or expense; excluded from cash in/out reports |
| Refund | Dr sales returns · Cr cash (or receivable if unpaid); restock: Dr inventory · Cr COGS | capped at what was sold and paid |
| Stock count adjustment | Dr/Cr inventory · Cr/Dr inventory adjustment | losses at average cost |
| Void | exact mirror of the original lines and stock movements | original kept and marked *voided*; a sale with payments must have its payments voided first |

## Inventory: weighted average cost

Each product keeps a pool of `quantity_on_hand` and `inventory_value_minor`.

- Stock in: quantity and value increase by the purchase cost.
- Stock out: COGS = `round(pool value × quantity ÷ pool quantity)`. When the last unit leaves, it takes the whole remaining value, so the pool always empties to exactly zero (no drift).
- Every change is a row in `inventory_movements` (with quantity and value *after*). The product's totals are updated only by the movement trigger, and clients can't edit them directly. Stock can't go negative, so a sale that would oversell is rejected as a whole.

## Figures shown in the app

Defined once in `src/core/finance/metrics.ts` and used by every screen, report and AI answer:

| Figure | Definition |
|---|---|
| Net sales | sales revenue − sales returns |
| Gross profit | net sales − COGS |
| Operating expenses | debits to operating-expense categories |
| Net operating profit | gross profit − operating expenses − stock losses |
| Net after interest | net operating profit − interest |
| Cash | balance of all cash accounts |
| Customers owe you | receivable balance |
| You owe suppliers | payable balance |
| Stock value | inventory balance (at average cost) |

Loans, owner money, transfers and opening balances never affect profit.

**Estimates and gaps are labelled, never hidden.** Profit is marked *estimated* when sales include items with no recorded cost (e.g. imported or non-stock sales). Cash is flagged when no opening balance was recorded. The forecast lists what's missing (no planned payments, no bills, short history).

## Cash-flow forecast rules

Implemented in `src/core/forecast/` and unit-tested:

- Starts from today's recorded cash. Future events come only from **open** invoices and bills (their *outstanding* amount), and from planned payments not yet settled.
- A sale is never a cash event; only its collection is. A bill is one outflow, when due, not at creation and again at payment.
- Customers not yet overdue are assumed to pay on the due date (*expected*). **Overdue customer debts are *uncertain* and excluded by default.** Overdue bills and planned payments are assumed paid today (conservative).
- Sales projection (trailing average of cash sales) is optional, *uncertain*, and offered only with at least 14 days of history.
- What-if scenarios are pure functions over a copy of the baseline events and never write to the ledger.
