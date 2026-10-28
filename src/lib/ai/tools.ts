// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
import "server-only";
import { addDays, type IsoDate } from "@/core/dates";
import type { Fact } from "@/core/ai/facts";
import { textFact } from "@/core/ai/facts";
import { cedisToMinor, sanitizeForModel } from "@/core/ai/prompt";
import {
  presentCashPosition,
  presentForecast,
  presentLowStock,
  presentPayables,
  presentProfit,
  presentProfitComparison,
  presentReceivables,
  presentScenario,
  presentSpendSimulation,
  presentTopExpenses,
  type ToolOutput,
} from "@/core/ai/presenters";
import { salesProjection } from "@/core/forecast/events";
import { applyScenario, compareScenario } from "@/core/forecast/scenario";
import { scenarioAdjustment } from "@/core/validation/scenario";
import { formatMoney } from "@/core/money";
import type { AppContext } from "@/lib/context";
import {
  getForecast,
  getMoneyAccounts,
  getPosition,
  getProductVelocity,
  getProfitSummary,
  getReceivables,
} from "@/lib/data/finance";
import { listCustomers, listScenarios, scenarioAdjustments } from "@/lib/data/records";
import { previousComparablePeriod, resolvePeriod } from "@/lib/periods";

/** A record the AI drafted. It is only saved if the owner confirms it in the app. */
export interface RecordProposal {
  type: "expense" | "cash_sale" | "customer_payment";
  amount_minor: number;
  description: string;
  category?: string;
  customer_id?: string;
  customer_name?: string;
  date: IsoDate;
}

export interface ToolExecution {
  output: ToolOutput;
  proposal?: RecordProposal;
}

const PERIODS = new Set(["today", "this_week", "this_month", "last_month", "last_30_days"]);

/**
 * Executes a tool for the signed-in user's active business. Every figure is
 * computed by trusted code (database sums + core/finance + core/forecast).
 * Inputs from the model are validated; unknown tools are rejected.
 */
export async function executeTool(ctx: AppContext, name: string, input: Record<string, unknown>): Promise<ToolExecution> {
  const currency = ctx.business.currency;
  switch (name) {
    case "get_cash_position": {
      const [position, accounts] = await Promise.all([getPosition(ctx), getMoneyAccounts(ctx)]);
      return { output: presentCashPosition(position, accounts, currency) };
    }
    case "get_profit_summary":
    case "get_top_expenses": {
      const preset = typeof input.period === "string" && PERIODS.has(input.period) ? input.period : "this_month";
      const period = resolvePeriod(preset, ctx.today);
      const summary = await getProfitSummary(ctx, period);
      return { output: name === "get_profit_summary" ? presentProfit(summary, period.label, currency) : presentTopExpenses(summary, period.label, currency) };
    }
    case "compare_profit": {
      const current = resolvePeriod("this_month", ctx.today);
      const [a, b] = await Promise.all([getProfitSummary(ctx, current), getProfitSummary(ctx, previousComparablePeriod(ctx.today))]);
      return { output: presentProfitComparison(a, b, currency) };
    }
    case "get_receivables": {
      const limit = typeof input.limit === "number" ? Math.min(Math.max(Math.trunc(input.limit), 1), 20) : 10;
      return { output: presentReceivables(await getReceivables(ctx), ctx.today, limit, currency) };
    }
    case "get_payables": {
      const days = typeof input.days === "number" ? Math.min(Math.max(Math.trunc(input.days), 1), 90) : 14;
      const { result } = await getForecast(ctx, Math.max(days, 7));
      return { output: presentPayables(result.included, ctx.today, days, currency) };
    }
    case "get_low_stock":
      return { output: presentLowStock(await getProductVelocity(ctx, 30)) };
    case "get_cash_forecast": {
      const horizon = [7, 14, 30, 60, 90].includes(Number(input.horizon_days)) ? Number(input.horizon_days) : 30;
      const { result, baseline } = await getForecast(ctx, horizon);
      return { output: presentForecast(result, baseline.assumptions, baseline.gaps, ctx.today, currency) };
    }
    case "simulate_spend": {
      const amount = cedisToMinor(input.amount_ghs);
      const offset = Number.isInteger(input.day_offset) ? Math.min(Math.max(Number(input.day_offset), 0), 90) : 1;
      if (amount === null) throw new ToolInputError("amount_ghs must be a positive amount in cedis with at most 2 decimals");
      const label = typeof input.label === "string" && input.label.trim() ? sanitizeForModel(input.label, 60) : "Planned spend";
      const horizon = Math.max(30, offset + 14);
      const { inputs, baseline } = await getForecast(ctx, horizon);
      const applied = applyScenario(baseline.events, [{ kind: "one_off", direction: "out", amount_minor: amount, label, day_offset: offset }], {
        today: ctx.today,
        horizonDays: horizon,
        currency,
        projection: salesProjection(inputs, ctx.today),
        baselineHasProjection: false,
      });
      const cmp = compareScenario(Number(inputs.cash_balance_minor), baseline.events, applied.events, {
        start: ctx.today,
        horizonDays: horizon,
        reserve: inputs.business.min_cash_reserve_minor,
      });
      return { output: presentSpendSimulation(cmp, amount, addDays(ctx.today, offset), label, ctx.today, currency) };
    }
    case "run_saved_scenario": {
      const scenarios = await listScenarios(ctx);
      const wanted = typeof input.name === "string" ? input.name.trim().toLowerCase() : "";
      const match = wanted
        ? scenarios.find((s) => s.name.toLowerCase() === wanted) ?? scenarios.find((s) => s.name.toLowerCase().includes(wanted))
        : undefined;
      if (!match) {
        const facts: Fact[] = scenarios.map((s) => textFact("Saved scenario", sanitizeForModel(s.name, 120), name));
        return {
          output: {
            name,
            data: { saved_scenarios: scenarios.map((s) => sanitizeForModel(s.name, 120)) },
            facts,
            summary: scenarios.length
              ? `You have ${scenarios.length} saved scenario${scenarios.length === 1 ? "" : "s"}: ${scenarios.map((s) => `"${sanitizeForModel(s.name, 120)}"`).join(", ")}. Ask about one by name, or open Cash Flow to compare them.`
              : "You have no saved scenarios yet. Create one on the Cash Flow page.",
            gaps: [],
          },
        };
      }
      const adjustments = scenarioAdjustments(match)
        .map((a) => scenarioAdjustment.safeParse(a))
        .filter((r) => r.success)
        .map((r) => r.data!);
      const { inputs, baseline } = await getForecast(ctx, match.horizon_days);
      const applied = applyScenario(baseline.events, adjustments, {
        today: ctx.today,
        horizonDays: match.horizon_days,
        currency,
        projection: salesProjection(inputs, ctx.today),
        baselineHasProjection: false,
      }, new Set(inputs.open_bills.filter((b) => b.kind === "inventory").map((b) => `bill:${b.id}`)));
      const cmp = compareScenario(Number(inputs.cash_balance_minor), baseline.events, applied.events, {
        start: ctx.today,
        horizonDays: match.horizon_days,
        reserve: inputs.business.min_cash_reserve_minor,
      });
      return { output: presentScenario(match.name, cmp, applied.assumptions, applied.warnings, currency) };
    }
    case "propose_record": {
      const type = input.type;
      if (type !== "expense" && type !== "cash_sale" && type !== "customer_payment") throw new ToolInputError("type must be expense, cash_sale or customer_payment");
      const amount = cedisToMinor(input.amount_ghs);
      if (amount === null) throw new ToolInputError("amount_ghs must be a positive amount in cedis");
      const description = sanitizeForModel(String(input.description ?? ""), 200) || (type === "expense" ? "Expense" : "Sale");
      const offset = Number.isInteger(input.day_offset) ? Math.min(Math.max(Number(input.day_offset), -30), 0) : 0;
      const proposal: RecordProposal = { type, amount_minor: amount, description, date: addDays(ctx.today, offset) };
      if (typeof input.category === "string") proposal.category = sanitizeForModel(input.category, 60);
      if (type === "customer_payment") {
        const wanted = String(input.customer_name ?? "").trim().toLowerCase();
        const customer = (await listCustomers(ctx)).find((c) => c.name.toLowerCase() === wanted) ?? null;
        if (!customer) throw new ToolInputError("customer_name does not match a customer; ask the owner which customer paid");
        proposal.customer_id = customer.id;
        proposal.customer_name = customer.name;
      }
      const label = type === "expense" ? "expense" : type === "cash_sale" ? "cash sale" : `payment from ${proposal.customer_name}`;
      return {
        proposal,
        output: {
          name,
          data: { drafted: true, saved: false, type, amount_minor: amount, description, date: proposal.date },
          facts: [{ label: "Drafted (not saved)", value: `${label}: ${formatMoney(amount, { currency })}`, kind: "money", minor: amount, source: name }],
          summary: `I've drafted a ${label} of ${formatMoney(amount, { currency })} ("${description}"). It is NOT saved yet — review and confirm it below.`,
          gaps: [],
        },
      };
    }
    default:
      throw new ToolInputError(`Unknown tool: ${name}`);
  }
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
