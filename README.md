# BizPilot AI

**Know your business today. Understand your cash tomorrow.**

BizPilot AI is a business-management and cash-flow intelligence app for small retailers in Ghana (phone and electronics shops, clothing and cosmetics stores, mini-marts, small wholesalers). It works on a phone first.

- **BizPilot** records sales (cash and credit), expenses, stock, customer debts, supplier bills, loans, owner money and transfers. It does this in a double-entry ledger, so revenue, cash, profit and debts are never confused with each other.
- **CashFlow AI** forecasts cash day by day for 7–90 days, warns before a shortfall, and lets the owner test a decision ("buy GH₵2,000 of stock tomorrow?") against the current forecast without touching real records. An AI assistant explains the numbers in plain language. Every figure comes from trusted calculations, never from the model.

> This is an operational management tool, **not** a statutory accounting, tax or payments system. Forecasts are estimates, not guarantees.

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Environment configuration](#environment-configuration)
6. [Supabase setup and migrations](#supabase-setup-and-migrations)
7. [Development commands](#development-commands)
8. [Tests](#tests)
9. [Deployment (Vercel)](#deployment-vercel)
10. [Hackathon demo](#hackathon-demo)
11. [Security and privacy](#security-and-privacy)
12. [Verification status](#verification-status)
13. [Known limitations](#known-limitations)

Further reading: [`docs/ACCOUNTING.md`](docs/ACCOUNTING.md) · [`docs/AI.md`](docs/AI.md) · [`docs/DEMO.md`](docs/DEMO.md)

---

## Features

| Area | What works |
|---|---|
| **Accounts & onboarding** | Email/password sign-up, login, logout, session refresh. Business setup asks only for name, type, currency (default GHS), optional opening cash and an optional minimum cash reserve. Users can belong to several businesses and switch between them. |
| **Dashboard** | Cash now (per money account), sales today/period, gross profit, net operating profit (flagged *estimated* when costs are missing), customer debts (with overdue amount), supplier bills, 30-day forecast, upcoming obligations, low stock, recent activity, alerts and a calculated summary. Period filter. Helpful empty state; no fake figures. |
| **Transactions** | Cash sale, credit sale, customer payment, stock purchase (paid or on credit), expense, supplier bill, supplier payment, loan received, loan repayment (principal + interest), owner contribution/withdrawal, refund (with optional restock), transfer between accounts. Search, type and date filters, pagination, detail view with ledger lines, stock movements and audit history. Descriptive fields are editable; amounts are corrected by **voiding** (an exact reversing entry), never by deleting. |
| **Inventory** | Products with SKU, prices, cost, threshold, supplier, barcode, expiry. Archive and restore. Opening stock, stock received, stock sold, count adjustments. Movement ledger per product. Low-stock detection, stock value, fast and slow movers. **Weighted average cost.** Stock can never go negative or diverge from its ledger. |
| **Customers** | Balances, credit limits, payment terms, due dates, ageing (days outstanding/overdue), payment recording, history. A reminder message the owner reviews and sends from their own WhatsApp/SMS (nothing is sent automatically). |
| **Suppliers** | Bills workflow: draft → open → partially paid → paid, overdue flag, discard draft, payments against a bill or oldest-first. Paying a bill never creates a second expense. |
| **Cash Flow** | Day-by-day forecast (7/14/30/60/90 days) with each event labelled *confirmed / scheduled / expected / uncertain*. Overdue customer debts are excluded by default. Optional sales projection. Planned payments (rent, wages, loan repayments; once, weekly or monthly). Alerts for shortfalls, reserve breaches, bills due before collections, overdue debts, expected collections that didn't arrive (forecast vs actual), upcoming obligations, unusual expenses and low stock, de-duplicated with dismissals that stick. **What-if simulator**: one-off spend or income, early or late customer payment, delayed expense, sales up or down %, supplier price change %, new monthly cost (e.g. hiring). Baseline vs scenario on one chart, closing cash, lowest point, shortfall date, differences, assumptions. Scenarios are saved only on request and never change records. |
| **AI Assistant** | Chat scoped to the business and user, powered by Google Gemini (or Anthropic Claude). Tool-calling: the model asks for figures and trusted server code computes them. Answers show their source figures, warnings and data gaps. Figures in the answer are checked against tool results. The assistant can **draft** a sale, expense or payment, which the owner confirms in a normal form. Rate limited. Without an API key, a built-in calculator answers common questions and says that AI is not configured. |
| **Reports** | Sales, expenses by category, gross and net operating profit, cash movement (money in, money out, net, balance per money account; transfers between your own accounts excluded), receivables, payables, inventory valuation, 6-month trends. Date range filter. Printable. |
| **CSV import** | Transactions (sales and expenses) and products. Upload → preview → column mapping → validation → duplicate detection (within the file and against earlier imports) → confirmation → summary. The server re-validates everything, and the database refuses a row it has already imported. |
| **Demo mode** | One click creates a clearly labelled fictional electronics shop ("Kofi's Phone Hub (Demo)"), separate from real businesses. See [`docs/DEMO.md`](docs/DEMO.md). |

## Architecture

```
Browser (React 19, Tailwind)                       Supabase
┌──────────────────────────┐   server actions    ┌───────────────────────────────┐
│ Pages (App Router)       │ ─────────────────▶  │ Auth (email + password)       │
│ Client forms, charts,    │   route handlers    │ PostgREST (user JWT → RLS)    │
│ forecast workspace       │ ◀─────────────────  │ PostgreSQL                    │
└──────────────────────────┘                     │  • tables + RLS (default deny) │
          │ same pure engine                     │  • posting RPCs (atomic,      │
          ▼                                      │    idempotent, audited)       │
 src/core/** (pure TypeScript, unit-tested)      │  • read RPCs (SECURITY        │
  money · dates · finance/metrics · forecast ·   │    INVOKER, RLS applies)      │
  scenario · alerts · validation · csv · ai      └───────────────────────────────┘
          ▲
 src/lib/** (server only): Supabase client, request context, data loaders,
            server actions, AI orchestrator → LLM provider (server-side key)
```

**Key decisions and why**

| Decision | Alternatives considered | Why this one |
|---|---|---|
| **Double-entry ledger in Postgres** (`transactions` + `ledger_entries` that sum to zero) | Single "transactions" table with a type column and per-screen maths | Revenue vs cash, profit vs balance, loans vs income and transfers fall out of the account a line hits, so they can't be double-counted by a UI bug. It's the industry-standard model. |
| **All financial writes in `SECURITY DEFINER` posting functions** | Writing rows from Next.js | One database transaction per business event: ledger, stock, invoice/bill, payment and audit rows succeed or fail together. Clients have no direct write access to ledger tables. Idempotency keys make retries safe. |
| **Money as `BIGINT` pesewas** | `NUMERIC`, JS floats | Exact integer arithmetic end to end; rounding happens only in explicit, tested helpers (`src/core/money.ts`). |
| **Weighted average cost** | FIFO, specific identification | Simple to explain to a shop owner, exact with integer pools (COGS = pool value × qty ÷ pool qty; the last unit takes the remainder, so the pool empties to exactly zero). |
| **RLS everywhere, no service-role key in the app** | Server-side admin client + app-level checks | Tenant isolation is enforced by the database even if application code has a bug. The anon key is safe in the browser. |
| **Pure TypeScript core** for metrics and forecasting, shared by server, browser and AI | Duplicated calculations | One definition of each figure. The what-if simulator runs instantly in the browser using the same code the server and assistant use. |
| **AI = explainer over trusted tools** | Letting the model read tables or do maths | The model cannot invent figures. Figures in answers are verified, and record changes need human confirmation. |

Project layout:

```
src/
  app/                 routes: (auth) login/signup, onboarding, (app)/* pages, api/assistant, privacy
  components/          ui/ (buttons, fields, cards, tables, badges, dialogs, money), forms/, charts/, cashflow/, assistant/, import/, layout/
  core/                pure domain logic — money, dates, finance/metrics, forecast/{events,engine,scenario,alerts}, validation, import/csv, ai/{prompt,intent,presenters,validate,facts}, reminders
  lib/                 server-only — env, supabase client, context (user + active business), data/ loaders, actions/ (server actions), ai/ (provider, tools, orchestrator)
  proxy.ts             session refresh + redirect for signed-out users (Next 16 "proxy", formerly middleware)
supabase/
  migrations/          0001–0009: schema, ledger, posting/read functions, RLS, demo
  tests/               SQL test files + bootstrap (local Supabase shim, helpers)
tests/unit/            node:test unit tests for src/core
docs/                  ACCOUNTING.md, AI.md, DEMO.md
```

## Prerequisites

- **Node.js 22 LTS** or newer (Next.js 16 needs ≥ 20.9; the unit-test glob needs ≥ 22).
- **npm** 10+.
- A **Supabase** project (free tier is fine), or the Supabase CLI + Docker for a local stack.
- For database tests: `psql`/`createdb` (PostgreSQL client 15+). On Windows, run the scripts from WSL or Git Bash.
- Optional: a **Google Gemini API key** (Google AI Studio) or an **Anthropic API key** for AI explanations.

## Installation

```bash
git clone <your-repo-url> bizpilot-ai
cd bizpilot-ai
npm install
cp .env.example .env.local      # then fill in the values (next section)
npm run check                   # typecheck + lint + unit tests
npm run dev                     # http://localhost:3000
```

## Environment configuration

All variables are documented in [`.env.example`](.env.example).

| Variable | Where | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | yes | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | yes | The anon/**publishable** key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is also accepted). Safe in the browser because every table has RLS. |
| `NEXT_PUBLIC_SITE_URL` | server | recommended | Public URL, used for email-confirmation redirects. |
| `GEMINI_API_KEY` | **server only** | no | Google AI Studio key: enables AI explanations with Gemini (used first when set). Never prefix with `NEXT_PUBLIC_`. |
| `ANTHROPIC_API_KEY` | **server only** | no | Alternative provider (Claude). |
| `AI_PROVIDER` | server only | no | `gemini` or `anthropic`, only needed when both keys are set. |
| `AI_MODEL` | server only | no | Defaults to `gemini-3.8-flash` (Gemini) or `claude-sonnet-5-5` (Anthropic). A model name for the other provider is ignored. |

The app **never** uses a Supabase service-role key. Don't add one.

## Supabase setup and migrations

### Option A: hosted Supabase (simplest)

1. Create a project at [supabase.com](https://supabase.com). Choose a region close to Ghana (e.g. EU West).
2. **Apply the migrations** in `supabase/migrations/`, in filename order:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   **Or, without the CLI:** open **SQL Editor → + New query**, paste the whole of **`supabase/setup.sql`** (all migrations combined, in order) and click **Run** once. Do this on a fresh project only.
3. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (later your production URL)
   - Redirect URLs: `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`
4. **Authentication → Providers → Email**: leave "Confirm email" on for production. For a hackathon demo you can turn it off so sign-up goes straight to onboarding.
5. Copy the Project URL and anon/publishable key into `.env.local`.

### Option B: local Supabase (Docker)

```bash
npx supabase start          # prints API URL, anon key, DB URL
npx supabase db reset       # applies supabase/migrations/* to the local database
```

Put the printed API URL and anon key in `.env.local`. `supabase/config.toml` sets the local site URL and redirect and turns off email confirmation locally. If your CLI version rejects it, delete it and run `npx supabase init` (your migrations are kept).

### Changing the schema

Add a new timestamped file to `supabase/migrations/` (never edit an applied one), run `npx supabase db reset` locally, then `npm run test:db`, then `npx supabase db push`.

## Development commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run check` | typecheck + lint + unit tests |

## Tests

```bash
npm run test:unit      # pure TypeScript domain logic (node:test via tsx)
npm run test:db        # SQL tests against a real PostgreSQL (RLS genuinely exercised)
npm run test:all       # typecheck + unit + db
```

`test:db` creates a throwaway database, applies a small **local Supabase shim** (an `auth.users` table, `auth.uid()`, and the `authenticated`/`anon` roles, created only if missing), all migrations and test helpers. It then runs every `supabase/tests/*.test.sql` in its own rolled-back transaction. It uses standard libpq variables:

```bash
# against the Supabase CLI's local Postgres
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres npm run test:db
```

Tests impersonate users exactly as PostgREST does (`set local role authenticated` + JWT `sub` claim), so Row Level Security is really tested, not mocked.

**Coverage of the required test list:**

| # | Requirement | Where |
|---|---|---|
| 1 | Cash sale increases cash and revenue | `01_accounting_rules.test.sql`, `metrics.test.ts` |
| 2 | Credit sale increases receivables, not cash | `01_accounting_rules.test.sql` |
| 3 | Collecting a debt: cash ↑, receivables ↓, no extra revenue | `01_accounting_rules.test.sql` |
| 4 | Paying a supplier bill: cash ↓, payables ↓, no extra purchase | `01_accounting_rules.test.sql` |
| 5 | Loan proceeds are not revenue | `01_accounting_rules.test.sql`, `metrics.test.ts` |
| 6 | Loan principal repayment is not an operating expense | `01_accounting_rules.test.sql` |
| 7 | Internal transfers create no income/expense | `01_accounting_rules.test.sql` |
| 8 | Inventory movements reconcile to stock quantity and value | `02_inventory.test.sql` |
| 9 | Duplicate payments/imports cannot double-count | `03_idempotency_duplicates.test.sql`, `csv-import.test.ts` |
| 10 | Forecast dates and balances | `forecast.test.ts` |
| 11 | A scenario does not change records | `07_demo_and_reads.test.sql`, `scenario.test.ts` |
| 12 | One business cannot access another's records | `04_tenant_isolation.test.sql` |
| 13 | Negative amounts / invalid dates rejected | `05_validation.test.sql`, `validation.test.ts` |
| 14 | Missing data → clear warning, not a made-up figure | `metrics.test.ts`, `forecast.test.ts`, `ai.test.ts` |

Plus: weighted average cost, atomic rollback of a partly invalid sale, voids and audit log, staff vs owner permissions, refunds, alert de-duplication, AI figure validation and prompt-injection sanitising, CSV parsing, reminders, the demo story, and AI rate limiting.

## Deployment (Vercel)

1. Push the repo to GitHub and import it in Vercel (framework preset: Next.js).
2. Set the environment variables from the table above for Production (and Preview if wanted). Set `NEXT_PUBLIC_SITE_URL` to the production URL.
3. Deploy. Then add `https://<your-domain>/auth/callback` to Supabase **Redirect URLs** and set the Site URL.
4. Smoke test: sign up → set up business → record a sale → open Cash Flow → ask the assistant a question.

Security headers (CSP, HSTS, frame-deny, etc.) are set in `next.config.ts`. The CSP allows connections only to your own origin and your Supabase project.

## Hackathon demo

On the onboarding screen (or after signing up), choose **Explore the demo shop**. Full presenter script: [`docs/DEMO.md`](docs/DEMO.md).

The story is: GH₵3,000 cash today, rent GH₵1,000 due in 3 days, supplier bill GH₵1,500 in 5 days, Ama owes GH₵2,000 due in 10 days, and Yaw owes GH₵450 overdue (treated as uncertain). The current forecast's lowest point is exactly the GH₵500 reserve. Buying GH₵2,000 of stock tomorrow causes a **GH₵1,500 shortfall from day 5 until Ama pays**: a timing problem, not a profitability problem.

## Security and privacy

- Authentication by Supabase Auth. Sessions are refreshed in `src/proxy.ts`, and the server verifies the user with `auth.getUser()`, never just the cookie.
- **Row Level Security on every table** (default deny). Read RPCs run as the caller (RLS applies). Posting RPCs check membership and role explicitly. Every business-scoped foreign key includes `business_id`, so cross-tenant references are structurally impossible.
- Roles: owner, manager, staff. Staff can record day-to-day activity but can't void records, change settings or read the audit log.
- Server-side validation with Zod on every action, then database constraints and business-rule checks.
- Append-only audit log for postings, voids, edits and master-data changes.
- AI: API key is server-only. Only computed figures and short, sanitised labels are sent to the model; phone numbers and notes are never sent. Business text is treated as data, not instructions. Per-user hourly rate limit (40 requests).
- Open-redirect-safe login redirects, same-origin check on the AI endpoint, CSP and security headers, no `dangerouslySetInnerHTML`.
- Privacy notice at `/privacy`.

**Before a production launch in Ghana:** review obligations under the **Data Protection Act, 2012 (Act 843)**, including registration with the **Data Protection Commission** as a data controller, a lawful basis for processing customer phone numbers, and international-transfer considerations for hosting and the AI provider. Before adding Mobile Money, bank or payment integrations, review the applicable **Bank of Ghana** requirements (e.g. payment-systems licensing and partner obligations). This MVP connects to no bank or MoMo account and verifies no payments.

## Verification status

This is what was verified in the build environment, and how:

| Check | Result |
|---|---|
| Unit tests (`npm run test:unit`) | **104 passing** |
| Database tests (`npm run test:db`) on PostgreSQL 16 | **52 checks passing**, all 9 migrations apply cleanly |
| Demo story through real DB functions + forecast engine | Matches the script (see above) |
| TypeScript compile of the whole app (`src/**`, `tests/**`) | **0 errors**, compiled against temporary type stubs for Next.js/React/Recharts/Supabase |
| `npm install`, `next build`, `eslint`, running the UI in a browser | **Not run.** The build environment had no access to the npm registry. Run `npm install && npm run check && npm run build` first; any issue will surface there. |

## Known limitations

- **First full build not yet run** (see above). The stub-typed compile checks the app's own code thoroughly, but not exact third-party prop types (Recharts, Next.js). Expect, at most, small fixes on the first `npm run build`.
- No automated browser end-to-end tests yet. Workflows are covered at the database and domain level. Adding Playwright smoke tests (signup → sale → dashboard → forecast) is the recommended next step.
- AI providers: Google Gemini and Anthropic Claude are implemented behind one interface (`src/lib/ai/provider.ts`); request/response translation for Gemini is unit-tested, but live calls are only exercised when you run the app with a key.
- No team-invitation screen yet (roles exist and are enforced in the database).
- One currency per business (GHS by default). No VAT/NHIL/GETFund levies or tax reporting. Not statutory accounts.
- No bank, Mobile Money or SMS/WhatsApp integrations. Payment methods are labels. Reminders open the owner's own WhatsApp/SMS with a prefilled message.
- Sales projection in the forecast is a simple trailing average and is **off by default**.
- CSV import covers simple sales/expense rows and products, not itemised sales or customer/supplier balances.
- Interest and loan schedules: repayments are recorded as they happen; schedule them as planned payments for the forecast.
