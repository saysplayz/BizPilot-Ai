# BizPilot AI — Team & ownership

Four parts, each owned end to end by one person. Every source file starts with a header saying which part it belongs to and who owns it:

```ts
// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
```

To put real names everywhere at once (headers and this file):

```bash
node scripts/set-team-names.mjs "Name 1" "Name 2" "Name 3" "Name 4"
```

| Part | Owner | Area | Size |
|---|---|---|---|
| 1 | Member 1 | **Database & Security**: Supabase schema, accounting ledger, Row Level Security, server data layer, project setup | ~5,000 lines |
| 2 | Member 2 | **Finance Engine & Testing**: money maths, profit metrics, cash-flow forecast, what-if scenarios, alerts, CSV parsing, all automated tests | ~4,200 lines |
| 3 | Member 3 | **AI Assistant & Data Entry**: Gemini assistant (tools, validation, providers), record forms, server actions | ~4,700 lines |
| 4 | Member 4 | **Frontend & UI/UX**: design system, every page, dashboard, charts, cash-flow screen, README and demo script | ~4,700 lines |

---

## Part 1 — Database & Security (Member 1)

**Files**
- Project setup: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `TEAM.md`
- `supabase/migrations/*` (9 files), `supabase/setup.sql`, `supabase/config.toml`
- `src/lib/supabase/`, `src/lib/data/`, `src/lib/context.ts`, `src/lib/env.ts`, `src/lib/errors.ts`, `src/proxy.ts`, `src/app/auth/callback/`
- `scripts/build-setup-sql.mjs`, `scripts/set-team-names.mjs`, `docs/ACCOUNTING.md`

**Be ready to explain**
- Why a **double-entry ledger**: every transaction's lines sum to zero, so a credit sale raises "customers owe you" but not cash, and a loan is never revenue.
- **Row Level Security**: each business only ever sees its own rows, enforced by the database, not just the app (`0008_security.sql`).
- **Posting functions** (`0005`): one database transaction per business event. Ledger lines, stock, invoice and audit log save together or not at all. **Idempotency keys** stop double-submits.
- Money is stored as whole **pesewas** (BIGINT), never decimals, so totals are exact.
- How the app reaches Supabase (`src/lib/supabase/server.ts`), and why there's no service-role key.

## Part 2 — Finance Engine & Testing (Member 2)

**Files**
- `src/core/money.ts`, `src/core/dates.ts`, `src/core/finance/`, `src/core/forecast/`, `src/core/validation/`, `src/core/import/csv.ts`, `src/core/reminders.ts`, `src/lib/periods.ts`
- `tests/unit/*` (except the two `ai*` tests), `tests/fixtures/demo.ts`
- `supabase/tests/*`, `scripts/test-db.sh`

**Be ready to explain**
- `metrics.ts` is the **single source of truth**: sales, gross profit and net operating profit are defined once and used by every screen and the AI.
- The **forecast** (`events.ts`, `engine.ts`): closing cash = opening + money in − money out, day by day. Overdue debts are "uncertain" and left out, and bills are counted once.
- **What-if scenarios** (`scenario.ts`) work on a copy and never change real records.
- **Tests**: run `npm run test:unit` (104 tests) and `npm run test:db` (52 database checks), and show the 14 required checks from the README table.

## Part 3 — AI Assistant & Data Entry (Member 3)

**Files**
- `src/core/ai/` (prompt, tools schema, Gemini translation, figure validation, presenters, intent)
- `src/lib/ai/` (provider, tools, orchestrator), `src/app/api/assistant/`, `src/app/(app)/assistant/`, `src/components/assistant/`
- `src/lib/actions/` (server actions), `src/components/forms/` (all record forms)
- `tests/unit/ai.test.ts`, `tests/unit/ai-provider.test.ts`, `docs/AI.md`

**Be ready to explain**
- The AI **never calculates**. Gemini calls our tools, the tools compute figures from the database, and Gemini only explains them.
- **Answer checking** (`validate.ts`): every GH₵ amount in an answer must match a calculated figure, otherwise the user sees a warning.
- **Safety**: no phone numbers or notes go to the AI, and shop text is treated as data, not instructions. Records drafted by the AI need the owner's confirmation.
- Without an API key, the built-in calculator still answers common questions.
- **Forms → server actions → posting functions**: Zod validates every form on the server first.

## Part 4 — Frontend & UI/UX (Member 4)

**Files**
- `src/components/ui/` (buttons, fields, cards, tables, badges, dialogs, money), `src/components/layout/`, `src/components/charts/`, `src/components/cashflow/`, `src/components/import/`, other shared components
- All pages in `src/app/` (except the assistant page and auth callback), `src/app/globals.css`, `public/`
- `README.md`, `docs/DEMO.md`

**Be ready to explain**
- **Mobile first**: a bottom tab bar on phones, a sidebar on desktop, and large touch targets.
- **Plain language**: "Customers owe you" instead of "receivables", and estimates labelled as estimates.
- The **cash-flow screen**: baseline vs scenario chart, lowest point, shortfall date.
- **Accessibility**: labels on every field, keyboard navigation, colour plus words for status.
- Running the **demo script** (`docs/DEMO.md`).

---

## Uploading to GitHub (each person from their own account)

Each person gets a zip with **only their part** (`part1-database-security.zip`, `part2-finance-engine-testing.zip`, `part3-ai-assistant-data-entry.zip`, `part4-frontend-ui.zip`). Install **Git** (git-scm.com) and use **Git Bash** or the VS Code terminal.

### Member 1 goes first

1. On github.com: **New repository** → name `bizpilot-ai` → **do not** add a README, .gitignore or license → **Create**.
2. **Settings → Collaborators → Add people**: add the other three GitHub usernames.
3. Run:
   ```bash
   git clone https://github.com/<member1-username>/bizpilot-ai.git
   cd bizpilot-ai
   git config user.name "Member 1 Full Name"
   git config user.email "member1-github-email@example.com"
   ```
4. Extract `part1-database-security.zip` **into this `bizpilot-ai` folder**.
5. Commit in steps:
   ```bash
   git add package.json tsconfig.json next.config.ts eslint.config.mjs postcss.config.mjs .gitignore .env.example TEAM.md
   git commit -m "chore: project setup (Next.js, TypeScript, Tailwind, lint)"
   git add supabase/migrations
   git commit -m "feat(db): schema, double-entry ledger, posting functions and row level security"
   git add supabase scripts
   git commit -m "feat(db): one-shot setup script and Supabase config"
   git add .
   git commit -m "feat(server): Supabase client, session handling and data loaders"
   git push -u origin main
   ```
   If the branch is called `master`, use `git push -u origin master`.

### Members 2, 3 and 4 (any order, after Member 1 has pushed)

1. Accept the GitHub invitation email.
2. Run:
   ```bash
   git clone https://github.com/<member1-username>/bizpilot-ai.git
   cd bizpilot-ai
   git config user.name "Your Full Name"
   git config user.email "your-github-email@example.com"
   ```
3. Extract **your** zip into the `bizpilot-ai` folder, then run your commits (below).
4. Upload:
   ```bash
   git pull --rebase
   git push
   ```
   No two parts share a file, so there are no conflicts.

**Member 2**
```bash
git add src/core/money.ts src/core/dates.ts tests/unit/money.test.ts tests/unit/dates.test.ts
git commit -m "feat(core): exact money and date utilities with tests"
git add src/core/finance src/core/validation src/lib/periods.ts
git commit -m "feat(core): profit metrics and server-side validation"
git add src/core/forecast tests/fixtures
git commit -m "feat(forecast): cash-flow forecast, alerts and what-if scenarios"
git add supabase/tests scripts/test-db.sh
git commit -m "test(db): SQL tests for accounting rules, stock and tenant isolation"
git add .
git commit -m "feat(core): CSV import parser, reminders and unit tests"
```

**Member 3**
```bash
git add src/lib/actions
git commit -m "feat(actions): server actions for auth, setup and recording"
git add src/components/forms
git commit -m "feat(forms): sale, expense, payment, stock and settings forms"
git add src/core/ai tests/unit
git commit -m "feat(ai): assistant tools, figure validation and Gemini translation"
git add .
git commit -m "feat(ai): Gemini provider, assistant API and chat screen"
```

**Member 4**
```bash
git add src/components/ui src/app/globals.css public
git commit -m "feat(ui): design system components"
git add src/components/layout src/app/layout.tsx src/app/page.tsx src/app/not-found.tsx "src/app/(auth)" src/app/onboarding src/app/privacy
git commit -m "feat(ui): app shell, landing, login, sign-up and onboarding"
git add "src/app/(app)/dashboard" "src/app/(app)/transactions" "src/app/(app)/inventory" "src/app/(app)/customers" "src/app/(app)/suppliers"
git commit -m "feat(ui): dashboard, transactions, inventory, customers and suppliers"
git add .
git commit -m "feat(ui): cash-flow workspace, charts, reports, import and docs"
```

### After all four have pushed

Everyone runs `git pull`, then `npm install`, and creates their **own** `.env.local` (copy `.env.example`; Member 1 shares the Supabase URL and keys privately). `.env.local` is in `.gitignore`. **Never commit it.**
