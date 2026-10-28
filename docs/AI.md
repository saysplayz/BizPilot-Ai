# AI business assistant

## Principle

**The model explains; it never calculates or decides facts.** Every number in an answer comes from trusted backend code running against the signed-in user's own records.

## Request flow (`POST /api/assistant`)

1. **Authenticate and scope.** The Supabase session cookie is verified server-side (`auth.getUser()`), and the active business is re-checked against the user's memberships. All reads go through the user's own JWT, so Row Level Security limits them to that business.
2. **Abuse control.** Same-origin check, input length limit (1,000 characters), and a per-user quota in Postgres (`consume_ai_quota`, 40 requests per hour) that works across serverless instances.
3. **Tool calling** (`src/lib/ai/orchestrator.ts`). The model receives the question, up to 8 prior messages and a fixed set of tools (`src/core/ai/prompt.ts`):
   `get_cash_position`, `get_profit_summary`, `compare_profit`, `get_receivables`, `get_payables`, `get_low_stock`, `get_top_expenses`, `get_cash_forecast`, `simulate_spend`, `run_saved_scenario`, `propose_record`.
   Tool inputs are validated (enums, ranges, amounts with at most two decimals). Unknown tools are rejected. At most 4 rounds and 4 tools per round.
4. **Trusted calculations** (`src/lib/ai/tools.ts`). Each tool calls the same data loaders and pure functions as the dashboard (`src/core/finance/metrics.ts`, `src/core/forecast/*`). Results go to the model as compact JSON plus `data_gaps`.
5. **Explanation.** The system prompt requires plain language, no figures beyond the tool results, facts separated from suggestions ("You could…"), forecasts described as estimates, and missing data called out.
6. **Validation** (`src/core/ai/validate.ts`). Every money amount in the answer is extracted and must match a figure from the tool results or the user's own question. Unverified amounts are listed to the user as a warning. An answer with figures but no tool calls is flagged.
7. **Display.** The UI shows the answer, the **figures used** (label, value, source tool), warnings and data gaps, and any drafted record.

## Writing records

`propose_record` only **drafts** an expense, cash sale or customer payment. The chat shows it as *Drafted — not saved* with a **Review & confirm** button. That opens the normal *Record* form prefilled with the draft, where the owner can correct it and save. The save goes through the same validation and posting function as any manual entry and is tagged with source `ai_confirmed`. The model can't save, edit or delete anything, and old drafts are not re-offered when a conversation is reopened.

## Prompt injection and privacy

- Names, descriptions, categories and notes are user-entered data. Before reaching the model they are stripped of control characters and truncated (`sanitizeForModel`), sent only inside tool-result JSON, and the system prompt says to treat tool content strictly as data.
- **Not sent to the provider:** phone numbers, customer/supplier notes, emails, user IDs, raw tables. Only computed figures and short labels are sent (`src/core/ai/presenters.ts`, unit-tested).
- Conversation history is stored per business **and** per user (RLS), so staff can't read each other's chats.

## Without an AI key

If no AI key is set, or the provider fails or times out (30 s), the assistant falls back to a deterministic **calculator** (`calculatorAnswer`). It detects the intent with simple patterns (`src/core/ai/intent.ts`), runs the same tools, and replies with their summaries. It always says that AI explanations are not configured or unavailable. The rest of the app is unaffected.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | server only; Google AI Studio key (`AQ.…` auth keys and older `AIza…` keys both work). Used first when set. |
| `ANTHROPIC_API_KEY` | — | server only; alternative provider |
| `AI_PROVIDER` | auto | `gemini` or `anthropic` when both keys are set |
| `AI_MODEL` | `gemini-3.8-flash` / `claude-sonnet-5-5` | must match the provider (`gemini-…` / `claude-…`), otherwise the default is used |
| `GEMINI_API_BASE` | `https://generativelanguage.googleapis.com/v1beta` | override only for a proxy or regional endpoint |

Providers implement one small interface in `src/lib/ai/provider.ts` (`startChat` → `send(toolResults)`), and each keeps its native message format internally. For Gemini, the model's turns are sent back unchanged, so the *thought signatures* Gemini 3 models require between function-calling rounds are preserved. Request building and response parsing live in `src/core/ai/gemini.ts` and are unit-tested (`tests/unit/ai-provider.test.ts`).
