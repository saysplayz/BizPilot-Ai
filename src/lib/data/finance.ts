// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import "server-only";
import { cache } from "react";
import { addDays, type IsoDate } from "@/core/dates";
import { deriveAlerts, type DerivedAlert } from "@/core/forecast/alerts";
import { computeForecast } from "@/core/forecast/engine";
import { buildBaselineEvents } from "@/core/forecast/events";
import type { ForecastInputs, ForecastResult, BaselineForecast } from "@/core/forecast/types";
import {
  computePosition,
  computeProfit,
  type CashDay,
  type FinancialPosition,
  type MonthlyRow,
  type ProfitSummary,
} from "@/core/finance/metrics";
import type { AccountBalances, ActivityRow, LedgerAccount, Period } from "@/core/finance/types";
import type { AppContext } from "@/lib/context";
import { readRpc, unwrap } from "./rpc";

// ---------------------------------------------------------------------------
// Balances and profit — every screen goes through these.
// ---------------------------------------------------------------------------
export async function getAccountBalances(ctx: AppContext, asOf?: IsoDate): Promise<AccountBalances> {
  const rows = await readRpc<{ account: LedgerAccount; balance_minor: number }[]>(ctx.supabase, "get_account_balances", {
    p_business_id: ctx.business.id,
    p_as_of: asOf ?? ctx.today,
  });
  const out: AccountBalances = {};
  for (const r of rows ?? []) out[r.account] = Number(r.balance_minor);
  return out;
}

export const getPosition = cache(async (ctx: AppContext): Promise<FinancialPosition> => {
  const [balances, txCount] = await Promise.all([
    getAccountBalances(ctx),
    ctx.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id).eq("status", "posted"),
  ]);
  return computePosition(balances, {
    openingBalanceSet: ctx.business.opening_balance_set_at !== null,
    hasTransactions: (txCount.count ?? 0) > 0,
  });
});

/** Sales lines in the period with no recorded product cost (profit is then an estimate). */
async function getUncostedSales(ctx: AppContext, period: Period): Promise<number> {
  const res = await ctx.supabase
    .from("invoice_lines")
    .select("line_total_minor, invoices!inner(issue_date, status, business_id)")
    .eq("business_id", ctx.business.id)
    .eq("cost_minor", 0)
    .gt("line_total_minor", 0)
    .gte("invoices.issue_date", period.from)
    .lte("invoices.issue_date", period.to)
    .neq("invoices.status", "void");
  const rows = unwrap(res, "sales lines") as { line_total_minor: number }[];
  return rows.reduce((s, r) => s + Number(r.line_total_minor), 0);
}

export async function getProfitSummary(ctx: AppContext, period: Period): Promise<ProfitSummary> {
  const [activity, uncosted] = await Promise.all([
    readRpc<ActivityRow[]>(ctx.supabase, "get_period_activity", { p_business_id: ctx.business.id, p_from: period.from, p_to: period.to }),
    getUncostedSales(ctx, period),
  ]);
  return computeProfit({
    period,
    activity: (activity ?? []).map((a) => ({ ...a, amount_minor: Number(a.amount_minor) })),
    uncostedSalesMinor: uncosted,
  });
}

export async function getMoneyAccounts(ctx: AppContext) {
  const rows = await readRpc<{ financial_account_id: string; name: string; kind: "cash" | "mobile_money" | "bank"; balance_minor: number }[]>(
    ctx.supabase,
    "get_money_account_balances",
    { p_business_id: ctx.business.id },
  );
  return (rows ?? []).map((r) => ({ ...r, balance_minor: Number(r.balance_minor) }));
}

export async function getCashDaily(ctx: AppContext, period: Period): Promise<CashDay[]> {
  const rows = await readRpc<CashDay[]>(ctx.supabase, "get_cash_daily", { p_business_id: ctx.business.id, p_from: period.from, p_to: period.to });
  return (rows ?? []).map((r) => ({ day: r.day, inflow_minor: Number(r.inflow_minor), outflow_minor: Number(r.outflow_minor) }));
}

export async function getMonthlyActivity(ctx: AppContext, months = 6): Promise<MonthlyRow[]> {
  const rows = await readRpc<MonthlyRow[]>(ctx.supabase, "get_monthly_activity", { p_business_id: ctx.business.id, p_months: months });
  return (rows ?? []).map((r) => ({ ...r, amount_minor: Number(r.amount_minor) }));
}

/** Operating expenses in the last 30 days vs the 30 days before. */
export async function getExpenseTrend(ctx: AppContext): Promise<{ current: number; previous: number | null }> {
  const [cur, prev] = await Promise.all([
    getProfitSummary(ctx, { from: addDays(ctx.today, -29), to: ctx.today }),
    getProfitSummary(ctx, { from: addDays(ctx.today, -59), to: addDays(ctx.today, -30) }),
  ]);
  return { current: cur.operatingExpenses, previous: prev.operatingExpenses > 0 ? prev.operatingExpenses : null };
}

// ---------------------------------------------------------------------------
// Receivables, payables, stock
// ---------------------------------------------------------------------------
export interface ReceivableRow {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  issue_date: IsoDate;
  due_date: IsoDate;
  total_minor: number;
  outstanding_minor: number;
  days_outstanding: number;
  days_overdue: number;
}

export const getReceivables = cache(async (ctx: AppContext): Promise<ReceivableRow[]> => {
  const rows = await readRpc<ReceivableRow[]>(ctx.supabase, "get_receivables", { p_business_id: ctx.business.id });
  return (rows ?? []).map((r) => ({ ...r, total_minor: Number(r.total_minor), outstanding_minor: Number(r.outstanding_minor) }));
});

export interface PayableRow {
  bill_id: string;
  bill_number: string;
  supplier_id: string;
  supplier_name: string;
  kind: "inventory" | "expense";
  bill_date: IsoDate;
  due_date: IsoDate;
  total_minor: number;
  outstanding_minor: number;
  days_overdue: number;
  status: string;
}

export const getPayables = cache(async (ctx: AppContext): Promise<PayableRow[]> => {
  const rows = await readRpc<PayableRow[]>(ctx.supabase, "get_payables", { p_business_id: ctx.business.id });
  return (rows ?? []).map((r) => ({ ...r, total_minor: Number(r.total_minor), outstanding_minor: Number(r.outstanding_minor) }));
});

export interface VelocityRow {
  product_id: string;
  name: string;
  quantity_on_hand: number;
  low_stock_threshold: number;
  units_sold: number;
  revenue_minor: number;
}

export const getProductVelocity = cache(async (ctx: AppContext, days = 30): Promise<VelocityRow[]> => {
  const rows = await readRpc<VelocityRow[]>(ctx.supabase, "get_product_velocity", { p_business_id: ctx.business.id, p_days: days });
  return (rows ?? []).map((r) => ({ ...r, units_sold: Number(r.units_sold), revenue_minor: Number(r.revenue_minor) }));
});

export function lowStock(rows: readonly VelocityRow[]) {
  return rows.filter((r) => r.quantity_on_hand <= r.low_stock_threshold).sort((a, b) => a.quantity_on_hand - b.quantity_on_hand);
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------
export const getForecastInputs = cache(async (ctx: AppContext): Promise<ForecastInputs> => {
  const data = await readRpc<ForecastInputs>(ctx.supabase, "get_forecast_inputs", { p_business_id: ctx.business.id });
  // The database's "today" is UTC; the app's is the business timezone (identical for Accra).
  return { ...data, as_of: ctx.today };
});

export interface ForecastBundle {
  inputs: ForecastInputs;
  baseline: BaselineForecast;
  result: ForecastResult;
}

export async function getForecast(
  ctx: AppContext,
  horizonDays = 30,
  opts: { includeUncertain?: boolean; includeProjectedSales?: boolean } = {},
): Promise<ForecastBundle> {
  const inputs = await getForecastInputs(ctx);
  const baseline = buildBaselineEvents(inputs, { today: ctx.today, horizonDays, includeProjectedSales: opts.includeProjectedSales });
  const result = computeForecast(Number(inputs.cash_balance_minor), baseline.events, {
    start: ctx.today,
    horizonDays,
    reserve: inputs.business.min_cash_reserve_minor === null ? null : Number(inputs.business.min_cash_reserve_minor),
    includeUncertain: opts.includeUncertain,
  });
  return { inputs, baseline, result };
}

// ---------------------------------------------------------------------------
// Alerts: derive from current data, then sync with the database so unchanged
// situations are not re-announced and dismissals stick.
// ---------------------------------------------------------------------------
export interface AlertRow {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  first_seen_at: string;
}

export async function refreshAlerts(ctx: AppContext, forecast: ForecastResult): Promise<AlertRow[]> {
  const [receivables, payables, velocity, expenses] = await Promise.all([
    getReceivables(ctx),
    getPayables(ctx),
    getProductVelocity(ctx, 30),
    getExpenseTrend(ctx),
  ]);
  const derived: DerivedAlert[] = deriveAlerts({
    today: ctx.today,
    currency: ctx.business.currency,
    forecast,
    receivables,
    payables,
    expenses,
    lowStock: lowStock(velocity),
  });
  const { data, error } = await ctx.supabase.rpc("sync_alerts", { p_business_id: ctx.business.id, p_alerts: derived });
  if (error) {
    // Alerts are helpful, not critical: fall back to showing derived alerts without persistence.
    console.error("[alerts]", error.code, error.message);
    return derived.map((a, i) => ({ id: `local-${i}`, kind: a.kind, severity: a.severity, title: a.title, message: a.message, first_seen_at: new Date().toISOString() }));
  }
  return (data ?? []) as AlertRow[];
}
