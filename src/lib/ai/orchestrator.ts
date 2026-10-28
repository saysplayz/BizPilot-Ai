// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
import "server-only";
import { mergeFacts, type Fact } from "@/core/ai/facts";
import { parseQuestion } from "@/core/ai/intent";
import { SYSTEM_PROMPT, TOOL_DEFINITIONS } from "@/core/ai/prompt";
import type { ToolOutput } from "@/core/ai/presenters";
import { checkAnswerFigures } from "@/core/ai/validate";
import type { AppContext } from "@/lib/context";
import { AI_PROVIDER_LABEL, aiConfig } from "@/lib/env";
import { AiProviderError, startChat, type HistoryTurn, type ToolResult } from "./provider";
import { executeTool, ToolInputError, type RecordProposal } from "./tools";

export interface AssistantAnswer {
  answer: string;
  facts: Fact[];
  warnings: string[];
  proposal: RecordProposal | null;
  /** "ai" = model explanation; "calculator" = built-in answer (no AI configured or AI unavailable). */
  mode: "ai" | "calculator";
}

const MAX_TOOL_ROUNDS = 4;

/**
 * Answer a question about the active business.
 *   1. Tools compute every figure from the user's own (RLS-scoped) data.
 *   2. The model, if configured, explains the tool results.
 *   3. The answer is validated: money figures must come from tool results or
 *      the question; anything else is flagged to the user.
 */
export async function answerQuestion(ctx: AppContext, question: string, history: HistoryTurn[]): Promise<AssistantAnswer> {
  const parsed = parseQuestion(question, ctx.today);
  const config = aiConfig();
  if (!config) {
    const result = await calculatorAnswer(ctx, question);
    result.warnings.unshift("AI explanations are not configured (no GEMINI_API_KEY or ANTHROPIC_API_KEY on the server). This answer comes from BizPilot's built-in calculator.");
    return result;
  }

  const outputs: ToolOutput[] = [];
  let proposal: RecordProposal | null = null;
  let finalText = "";

  try {
    const chat = startChat(config, {
      system: `${SYSTEM_PROMPT}\n\nToday is ${ctx.today}. Currency: ${ctx.business.currency}. Amounts in tool results ending in _minor are pesewas (divide by 100 for cedis).${ctx.business.is_demo ? " This is a DEMO business with fictional data." : ""}`,
      history: history.slice(-8),
      question,
      tools: TOOL_DEFINITIONS,
      signal: AbortSignal.timeout(30_000),
    });
    let reply = await chat.send();
    for (let round = 0; ; round++) {
      finalText = reply.text;
      if (reply.toolCalls.length === 0 || round >= MAX_TOOL_ROUNDS) break;
      const results: ToolResult[] = [];
      for (const call of reply.toolCalls.slice(0, 4)) {
        try {
          const exec = await executeTool(ctx, call.name, call.input ?? {});
          outputs.push(exec.output);
          if (exec.proposal) proposal = exec.proposal;
          results.push({ id: call.id, name: call.name, content: JSON.stringify({ result: exec.output.data, data_gaps: exec.output.gaps }) });
        } catch (err) {
          const message = err instanceof ToolInputError ? err.message : "This calculation failed.";
          if (!(err instanceof ToolInputError)) console.error("[ai.tool]", call.name, err);
          results.push({ id: call.id, name: call.name, content: message, isError: true });
        }
      }
      // Calls beyond the first four still need an answer so the conversation stays valid.
      for (const call of reply.toolCalls.slice(4)) {
        results.push({ id: call.id, name: call.name, content: "Skipped: too many tool calls in one step.", isError: true });
      }
      reply = await chat.send(results);
    }
  } catch (err) {
    // Fall back to the calculator rather than failing the owner's question.
    const fallback = await calculatorAnswer(ctx, question);
    fallback.warnings.unshift(
      err instanceof AiProviderError
        ? `${err.message} Showing BizPilot's built-in answer instead.`
        : `The AI explanation (${AI_PROVIDER_LABEL[config.provider]}) failed. Showing BizPilot's built-in answer instead.`,
    );
    if (!(err instanceof AiProviderError)) console.error("[ai]", err);
    return fallback;
  }

  const facts = mergeFacts(...outputs.map((o) => o.facts));
  const warnings = [...new Set(outputs.flatMap((o) => o.gaps))];
  if (!finalText) finalText = outputs.map((o) => o.summary).join("\n\n") || "I couldn't find an answer to that in your records.";

  const check = checkAnswerFigures(finalText, facts, parsed.amounts);
  if (!check.ok) {
    warnings.push(
      `These amounts in the answer were not produced by BizPilot's calculations, so treat them with caution: ${check.unverified.map((u) => u.text).join(", ")}.`,
    );
  }
  if (outputs.length === 0 && /GH₵|cedi|\d/.test(finalText)) {
    warnings.push("No business records were checked for this answer.");
  }
  return { answer: finalText.slice(0, 4000), facts, warnings, proposal, mode: "ai" };
}

/** Deterministic answers for common questions — no AI involved. */
export async function calculatorAnswer(ctx: AppContext, question: string): Promise<AssistantAnswer> {
  const p = parseQuestion(question, ctx.today);
  const run = (name: string, input: Record<string, unknown> = {}) => executeTool(ctx, name, input).then((e) => e.output);
  let outputs: ToolOutput[];
  switch (p.intent) {
    case "cash_position":
      outputs = [await run("get_cash_position")];
      break;
    case "receivables":
      outputs = [await run("get_receivables", { limit: 5 })];
      break;
    case "restock":
      outputs = [await run("get_low_stock")];
      break;
    case "affordability":
      outputs = [await run("simulate_spend", { amount_ghs: p.amounts[0]! / 100, day_offset: p.dayOffset ?? 1, label: /stock|restock|goods/i.test(question) ? "Stock purchase" : "Planned spend" })];
      break;
    case "bills":
      outputs = [await run("get_payables", { days: 14 })];
      break;
    case "expenses":
      outputs = [await run("get_top_expenses", { period: /last month/i.test(question) ? "last_month" : "this_month" })];
      break;
    case "profit":
      outputs = [await run(/lower|why|compare|drop|fell/i.test(question) ? "compare_profit" : "get_profit_summary", { period: "this_month" })];
      break;
    case "scenario":
      outputs = [await run("run_saved_scenario", {})];
      break;
    case "forecast":
      outputs = [await run("get_cash_forecast", { horizon_days: /week/i.test(question) && !/month/i.test(question) ? 7 : 30 })];
      break;
    default:
      outputs = [await run("get_cash_position"), await run("get_cash_forecast", { horizon_days: 30 })];
      outputs[0] = { ...outputs[0]!, summary: `I can answer questions about your cash, customer debts, bills, stock, expenses, profit and forecast. Here is a quick overview: ${outputs[0]!.summary}` };
  }
  return {
    answer: outputs.map((o) => o.summary).join("\n\n"),
    facts: mergeFacts(...outputs.map((o) => o.facts)),
    warnings: [...new Set(outputs.flatMap((o) => o.gaps))],
    proposal: null,
    mode: "calculator",
  };
}
