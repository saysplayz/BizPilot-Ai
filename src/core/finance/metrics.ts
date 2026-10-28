// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * The single source of truth for business metrics.
 *
 * The database returns raw ledger sums (debit +, credit −). This module turns
 * them into the figures owners see. Every screen, report and AI answer calls
 * these functions, so "gross profit" means the same thing everywhere.
 *
 * Definitions (documented in docs/ACCOUNTING.md):
 *   sales (gross)          = credits to sales_revenue
 *   returns                = debits to sales_returns
 *   net sales              = sales − returns
 *   cost of goods sold     = net debits to cogs (weighted average cost)
 *   gross profit           = net sales − COGS
 *   operating expenses     = debits to operating_expense
 *   stock losses           = net debits to inventory_adjustment
 *   net operating profit   = gross profit − operating expenses − stock losses
 *   net profit after interest = net operating profit − interest
 * Loans, owner money, transfers and opening balances never appear here.
 */
import type { Minor } from "../money";
import { percentOf, sumMinor } from "../money";
import type { AccountBalances, ActivityRow, DataGap, LedgerAccount, Period } from "./types";

function total(rows: readonly ActivityRow[], account: LedgerAccount): Minor {
  return sumMinor(rows.filter((r) => r.account === account).map((r) => r.amount_minor));
}

export interface ProfitSummary {
  period: Period;
  grossSales: Minor;
  returns: Minor;
  netSales: Minor;
  cogs: Minor;
  grossProfit: Minor;
  grossMarginPct: number | null;
  operatingExpenses: Minor;
  expensesByCategory: { category: string; amount: Minor }[];
  stockLosses: Minor;
  netOperatingProfit: Minor;
  interest: Minor;
  netProfitAfterInterest: Minor;
  /** True when some sales have no recorded cost, so profit is overstated. */
  isEstimate: boolean;
  gaps: DataGap[];
}

export interface ProfitInputs {
  period: Period;
  activity: readonly ActivityRow[];
  /** Value of sales in the period recorded without a product cost (e.g. description-only or imported sales). */
  uncostedSalesMinor?: Minor;
}

export function computeProfit({ period, activity, uncostedSalesMinor = 0 }: ProfitInputs): ProfitSummary {
  const grossSales = -total(activity, "sales_revenue");
  const returns = total(activity, "sales_returns");
  const netSales = grossSales - returns;
  const cogs = total(activity, "cogs");
  const grossProfit = netSales - cogs;
  const operatingExpenses = total(activity, "operating_expense");
  const stockLosses = total(activity, "inventory_adjustment");
  const interest = total(activity, "interest_expense");
  const netOperatingProfit = grossProfit - operatingExpenses - stockLosses;

  const byCategory = new Map<string, Minor>();
  for (const row of activity) {
    if (row.account !== "operating_expense") continue;
    const key = row.category?.trim() || "Other";
    byCategory.set(key, (byCategory.get(key) ?? 0) + row.amount_minor);
  }
  const expensesByCategory = [...byCategory.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const gaps: DataGap[] = [];
  if (uncostedSalesMinor > 0) {
    gaps.push({
      code: "sales_without_cost",
      message:
        "Some sales were recorded without a product cost, so cost of goods sold is understated and profit is an estimate. Link sales to products with a unit cost to fix this.",
    });
  }

  return {
    period,
    grossSales,
    returns,
    netSales,
    cogs,
    grossProfit,
    grossMarginPct: percentOf(grossProfit, netSales),
    operatingExpenses,
    expensesByCategory,
    stockLosses,
    netOperatingProfit,
    interest,
    netProfitAfterInterest: netOperatingProfit - interest,
    isEstimate: uncostedSalesMinor > 0,
    gaps,
  };
}

export interface FinancialPosition {
  /** Money the business holds across cash, Mobile Money and bank accounts. */
  cash: Minor;
  /** Customers owe the business. */
  receivables: Minor;
  /** Stock at weighted-average cost. */
  inventory: Minor;
  /** The business owes suppliers. */
  payables: Minor;
  /** Loan principal still owed. */
  loans: Minor;
  /** What the business would have left if it collected and paid everything (cash + receivables + stock − payables − loans). */
  netWorth: Minor;
  gaps: DataGap[];
}

export function computePosition(
  balances: AccountBalances,
  context: { openingBalanceSet: boolean; hasTransactions: boolean },
): FinancialPosition {
  const b = (a: LedgerAccount) => balances[a] ?? 0;
  const cash = b("cash");
  const receivables = b("accounts_receivable");
  const inventory = b("inventory");
  const payables = -b("accounts_payable");
  const loans = -b("loans_payable");

  const gaps: DataGap[] = [];
  if (!context.openingBalanceSet) {
    gaps.push({
      code: "no_opening_balance",
      message:
        "Your opening cash balance has not been recorded, so the cash figure only reflects money recorded in BizPilot. Add it in Settings.",
    });
  }
  if (!context.hasTransactions) {
    gaps.push({ code: "no_transactions", message: "No sales or expenses have been recorded yet." });
  }
  if (cash < 0) {
    gaps.push({
      code: "negative_cash",
      message:
        "Recorded cash is below zero, which usually means some money received (or an opening balance) has not been recorded.",
    });
  }

  return {
    cash,
    receivables,
    inventory,
    payables,
    loans,
    netWorth: cash + receivables + inventory - payables - loans,
    gaps,
  };
}

/** Daily cash flow row (from get_cash_daily). */
export interface CashDay {
  day: string;
  inflow_minor: Minor;
  outflow_minor: Minor;
}

export function summariseCashFlow(days: readonly CashDay[]): { inflow: Minor; outflow: Minor; net: Minor } {
  const inflow = sumMinor(days.map((d) => d.inflow_minor));
  const outflow = sumMinor(days.map((d) => d.outflow_minor));
  return { inflow, outflow, net: inflow - outflow };
}

/** Compare two periods' expenses to detect unusual spikes. */
export function expenseSpike(current: Minor, previous: Minor | null): { ratio: number | null; isSpike: boolean } {
  if (previous === null || previous <= 0) return { ratio: null, isSpike: false };
  const ratio = current / previous;
  // At least 50% higher and at least GH₵200 more, so tiny shops don't get noise.
  return { ratio, isSpike: ratio >= 1.5 && current - previous >= 20_000 };
}

export interface MonthlyRow {
  month: string;
  account: LedgerAccount;
  amount_minor: Minor;
}

export interface MonthlyTrend {
  month: string;
  netSales: Minor;
  grossProfit: Minor;
  operatingExpenses: Minor;
  netOperatingProfit: Minor;
}

/** Turn get_monthly_activity rows into a trend series using the same definitions as computeProfit. */
export function monthlyTrends(rows: readonly MonthlyRow[]): MonthlyTrend[] {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  return months.map((month) => {
    const activity = rows.filter((r) => r.month === month).map((r) => ({ account: r.account, category: null, amount_minor: r.amount_minor }));
    const p = computeProfit({ period: { from: month, to: month }, activity });
    return {
      month,
      netSales: p.netSales,
      grossProfit: p.grossProfit,
      operatingExpenses: p.operatingExpenses,
      netOperatingProfit: p.netOperatingProfit,
    };
  });
}
