// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
/**
 * Tool presenters: turn trusted calculation results into
 *   - `data`: compact JSON for the model (no phone numbers or notes),
 *   - `facts`: the figures shown to the user under "Figures used",
 *   - `summary`: a deterministic plain-language answer used when no LLM is
 *     configured (so the assistant still works offline / without a key).
 */
import { diffDays, formatDate, relativeDay, type IsoDate } from "../dates";
import type { FinancialPosition, ProfitSummary } from "../finance/metrics";
import type { DataGap } from "../finance/types";
import { formatMoney, type Minor } from "../money";
import type { ScenarioComparison } from "../forecast/scenario";
import type { ForecastEvent, ForecastResult } from "../forecast/types";
import { countFact, dateFact, moneyFact, percentFact, textFact, type Fact } from "./facts";
import { sanitizeForModel } from "./prompt";

export interface ToolOutput {
  name: string;
  data: Record<string, unknown>;
  facts: Fact[];
  summary: string;
  gaps: string[];
}

const m = (v: Minor, currency = "GHS") => formatMoney(v, { currency });

function gapMessages(gaps: readonly DataGap[]): string[] {
  return gaps.map((g) => g.message);
}

// ---------------------------------------------------------------------------
export function presentCashPosition(
  position: FinancialPosition,
  accounts: readonly { name: string; balance_minor: Minor }[],
  currency = "GHS",
): ToolOutput {
  const name = "get_cash_position";
  const facts: Fact[] = [
    moneyFact("Cash available now", position.cash, name, currency),
    ...accounts.map((a) => moneyFact(`In ${sanitizeForModel(a.name, 60)}`, a.balance_minor, name, currency)),
    moneyFact("Customers owe you", position.receivables, name, currency),
    moneyFact("You owe suppliers", position.payables, name, currency),
    moneyFact("Stock value (at cost)", position.inventory, name, currency),
  ];
  if (position.loans > 0) facts.push(moneyFact("Loans outstanding", position.loans, name, currency));
  const parts = [`You have ${m(position.cash, currency)} recorded across your money accounts`];
  if (accounts.length > 1) parts[0] += ` (${accounts.map((a) => `${sanitizeForModel(a.name, 60)}: ${m(a.balance_minor, currency)}`).join(", ")})`;
  parts[0] += ".";
  if (position.receivables > 0) parts.push(`Customers owe you ${m(position.receivables, currency)}, which is not cash until they pay.`);
  if (position.payables > 0) parts.push(`You owe suppliers ${m(position.payables, currency)}.`);
  return {
    name,
    data: {
      cash_minor: position.cash,
      accounts: accounts.map((a) => ({ name: sanitizeForModel(a.name, 60), balance_minor: a.balance_minor })),
      receivables_minor: position.receivables,
      payables_minor: position.payables,
      inventory_value_minor: position.inventory,
      loans_minor: position.loans,
    },
    facts,
    summary: parts.join(" "),
    gaps: gapMessages(position.gaps),
  };
}

// ---------------------------------------------------------------------------
export function presentProfit(p: ProfitSummary, periodLabel: string, currency = "GHS"): ToolOutput {
  const name = "get_profit_summary";
  const facts = [
    moneyFact(`Sales (${periodLabel})`, p.netSales, name, currency),
    moneyFact("Cost of goods sold", p.cogs, name, currency),
    moneyFact("Gross profit", p.grossProfit, name, currency),
    percentFact("Gross margin", p.grossMarginPct, name),
    moneyFact("Operating expenses", p.operatingExpenses, name, currency),
    moneyFact(`Net operating profit${p.isEstimate ? " (estimate)" : ""}`, p.netOperatingProfit, name, currency),
  ];
  if (p.stockLosses !== 0) facts.push(moneyFact("Stock losses", p.stockLosses, name, currency));
  if (p.returns !== 0) facts.push(moneyFact("Refunds", p.returns, name, currency));
  const verdict = p.netOperatingProfit >= 0 ? "a profit" : "a loss";
  return {
    name,
    data: {
      period: { label: periodLabel, ...p.period },
      net_sales_minor: p.netSales,
      cogs_minor: p.cogs,
      gross_profit_minor: p.grossProfit,
      gross_margin_pct: p.grossMarginPct,
      operating_expenses_minor: p.operatingExpenses,
      expenses_by_category: p.expensesByCategory.slice(0, 6).map((e) => ({ category: sanitizeForModel(e.category, 60), amount_minor: e.amount })),
      stock_losses_minor: p.stockLosses,
      net_operating_profit_minor: p.netOperatingProfit,
      is_estimate: p.isEstimate,
    },
    facts,
    summary: `For ${periodLabel}, sales were ${m(p.netSales, currency)} and gross profit was ${m(p.grossProfit, currency)}. After ${m(p.operatingExpenses, currency)} of operating expenses, the business made ${verdict} of ${m(Math.abs(p.netOperatingProfit), currency)}${p.isEstimate ? " (an estimate, because some sales have no recorded cost)" : ""}.`,
    gaps: gapMessages(p.gaps),
  };
}

// ---------------------------------------------------------------------------
export function presentProfitComparison(current: ProfitSummary, previous: ProfitSummary, currency = "GHS"): ToolOutput {
  const name = "compare_profit";
  const profitChange = current.netOperatingProfit - previous.netOperatingProfit;
  const salesChange = current.netSales - previous.netSales;
  const gpChange = current.grossProfit - previous.grossProfit;
  const expenseChange = current.operatingExpenses - previous.operatingExpenses;

  const cats = new Map<string, { now: Minor; before: Minor }>();
  for (const e of current.expensesByCategory) cats.set(e.category, { now: e.amount, before: 0 });
  for (const e of previous.expensesByCategory) cats.set(e.category, { now: cats.get(e.category)?.now ?? 0, before: e.amount });
  const drivers = [...cats.entries()]
    .map(([category, v]) => ({ category, change: v.now - v.before }))
    .filter((d) => d.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 3);

  const facts: Fact[] = [
    moneyFact("Net operating profit this month so far", current.netOperatingProfit, name, currency),
    moneyFact("Same days last month", previous.netOperatingProfit, name, currency),
    moneyFact("Change in profit", profitChange, name, currency),
    moneyFact("Change in sales", salesChange, name, currency),
    moneyFact("Change in gross profit", gpChange, name, currency),
    moneyFact("Change in operating expenses", expenseChange, name, currency),
    percentFact("Gross margin this month", current.grossMarginPct, name),
    percentFact("Gross margin last month", previous.grossMarginPct, name),
    ...drivers.map((d) => moneyFact(`Change in ${sanitizeForModel(d.category, 60)} spending`, d.change, name, currency)),
  ];

  const reasons: string[] = [];
  if (salesChange < 0) reasons.push(`sales are ${m(-salesChange, currency)} lower`);
  if (salesChange > 0) reasons.push(`sales are ${m(salesChange, currency)} higher`);
  if (current.grossMarginPct !== null && previous.grossMarginPct !== null && current.grossMarginPct < previous.grossMarginPct - 2) {
    reasons.push(`your gross margin fell from ${previous.grossMarginPct}% to ${current.grossMarginPct}%`);
  }
  for (const d of drivers.filter((x) => x.change > 0)) reasons.push(`${d.category} spending is up ${m(d.change, currency)}`);

  return {
    name,
    data: {
      current: { period: current.period, net_sales_minor: current.netSales, gross_profit_minor: current.grossProfit, gross_margin_pct: current.grossMarginPct, operating_expenses_minor: current.operatingExpenses, net_operating_profit_minor: current.netOperatingProfit },
      previous: { period: previous.period, net_sales_minor: previous.netSales, gross_profit_minor: previous.grossProfit, gross_margin_pct: previous.grossMarginPct, operating_expenses_minor: previous.operatingExpenses, net_operating_profit_minor: previous.netOperatingProfit },
      profit_change_minor: profitChange,
      expense_category_changes: drivers.map((d) => ({ category: sanitizeForModel(d.category, 60), change_minor: d.change })),
    },
    facts,
    summary:
      `This month so far, net operating profit is ${m(current.netOperatingProfit, currency)} compared with ${m(previous.netOperatingProfit, currency)} over the same days last month` +
      (profitChange === 0 ? "." : ` (${profitChange > 0 ? "up" : "down"} ${m(Math.abs(profitChange), currency)}).`) +
      (reasons.length > 0 ? ` Main reasons: ${reasons.join("; ")}.` : ""),
    gaps: gapMessages([...current.gaps, ...previous.gaps]),
  };
}

// ---------------------------------------------------------------------------
export interface ReceivableRow {
  invoice_number: string;
  customer_name: string;
  due_date: IsoDate;
  outstanding_minor: Minor;
  days_overdue: number;
}

export function presentReceivables(rows: readonly ReceivableRow[], today: IsoDate, limit = 10, currency = "GHS"): ToolOutput {
  const name = "get_receivables";
  const byCustomer = new Map<string, { total: Minor; overdue: Minor; earliestDue: IsoDate }>();
  for (const r of rows) {
    const c = byCustomer.get(r.customer_name) ?? { total: 0, overdue: 0, earliestDue: r.due_date };
    c.total += r.outstanding_minor;
    if (r.days_overdue > 0) c.overdue += r.outstanding_minor;
    if (r.due_date < c.earliestDue) c.earliestDue = r.due_date;
    byCustomer.set(r.customer_name, c);
  }
  const customers = [...byCustomer.entries()]
    .map(([customer, v]) => ({ customer: sanitizeForModel(customer, 80), ...v }))
    .sort((a, b) => b.total - a.total);
  const total = customers.reduce((s, c) => s + c.total, 0);
  const overdue = customers.reduce((s, c) => s + c.overdue, 0);
  const top = customers.slice(0, limit);
  const facts: Fact[] = [
    moneyFact("Total customers owe", total, name, currency),
    moneyFact("Of which overdue", overdue, name, currency),
    countFact("Customers with balances", customers.length, name),
    ...top.map((c) => moneyFact(`${c.customer} owes`, c.total, name, currency)),
  ];
  const summary =
    customers.length === 0
      ? "No customers owe you money right now."
      : `${customers.length} customer${customers.length === 1 ? " owes" : "s owe"} you ${m(total, currency)} in total${overdue > 0 ? `, of which ${m(overdue, currency)} is overdue` : ""}. ` +
        `The largest balances: ${top.slice(0, 3).map((c) => `${c.customer} ${m(c.total, currency)} (${c.overdue > 0 ? "overdue" : `due ${relativeDay(c.earliestDue, today)}`})`).join(", ")}.`;
  return {
    name,
    data: { total_minor: total, overdue_minor: overdue, customers: top.map((c) => ({ name: c.customer, owes_minor: c.total, overdue_minor: c.overdue, earliest_due: c.earliestDue })) },
    facts,
    summary,
    gaps: [],
  };
}

// ---------------------------------------------------------------------------
export function presentPayables(outflows: readonly ForecastEvent[], today: IsoDate, days: number, currency = "GHS"): ToolOutput {
  const name = "get_payables";
  const upcoming = outflows
    .filter((e) => e.amount < 0 && diffDays(today, e.date) <= days)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = upcoming.reduce((s, e) => s - e.amount, 0);
  const facts: Fact[] = [
    moneyFact(`Due in the next ${days} days`, total, name, currency),
    ...upcoming.slice(0, 10).map((e) => moneyFact(`${sanitizeForModel(e.label, 80)} (${formatDate(e.date, { year: false })})`, -e.amount, name, currency)),
  ];
  return {
    name,
    data: {
      total_minor: total,
      items: upcoming.slice(0, 15).map((e) => ({ label: sanitizeForModel(e.label, 80), date: e.date, amount_minor: -e.amount, type: e.category, confidence: e.confidence })),
    },
    facts,
    summary:
      upcoming.length === 0
        ? `No bills or planned payments are recorded for the next ${days} days. If you have rent, wages or supplier bills coming, add them so the forecast is accurate.`
        : `You have ${m(total, currency)} to pay in the next ${days} days: ${upcoming.slice(0, 4).map((e) => `${sanitizeForModel(e.label, 80)} ${m(-e.amount, currency)} ${relativeDay(e.date, today)}`).join("; ")}. Pay the earliest-due and most essential ones first.`,
    gaps: [],
  };
}

// ---------------------------------------------------------------------------
export interface StockRow {
  name: string;
  quantity_on_hand: number;
  low_stock_threshold: number;
  units_sold: number; // in the window
}

export function presentLowStock(rows: readonly StockRow[], windowDays = 30): ToolOutput {
  const name = "get_low_stock";
  const low = rows
    .filter((r) => r.quantity_on_hand <= r.low_stock_threshold)
    .map((r) => {
      const perDay = r.units_sold / windowDays;
      return { ...r, name: sanitizeForModel(r.name, 80), days_left: perDay > 0 ? Math.floor(r.quantity_on_hand / perDay) : null };
    })
    .sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999));
  const facts: Fact[] = [
    countFact("Products at or below their low-stock level", low.length, name),
    ...low.slice(0, 8).map((r) => textFact(r.name, `${r.quantity_on_hand} left${r.days_left !== null ? ` (~${r.days_left} days at recent sales)` : ""}`, name)),
  ];
  return {
    name,
    data: { products: low.slice(0, 15).map((r) => ({ name: r.name, in_stock: r.quantity_on_hand, low_stock_level: r.low_stock_threshold, sold_last_30_days: r.units_sold, estimated_days_left: r.days_left })) },
    facts,
    summary:
      low.length === 0
        ? "No products are at their low-stock level right now."
        : `${low.length} product${low.length === 1 ? " needs" : "s need"} restocking: ${low.slice(0, 5).map((r) => `${r.name} (${r.quantity_on_hand} left${r.days_left !== null ? `, about ${r.days_left} days at recent sales` : ""})`).join(", ")}.`,
    gaps: [],
  };
}

// ---------------------------------------------------------------------------
export function presentTopExpenses(p: ProfitSummary, periodLabel: string, currency = "GHS"): ToolOutput {
  const name = "get_top_expenses";
  const top = p.expensesByCategory.slice(0, 6);
  return {
    name,
    data: { period: periodLabel, total_minor: p.operatingExpenses, categories: top.map((e) => ({ category: sanitizeForModel(e.category, 60), amount_minor: e.amount })) },
    facts: [moneyFact(`Operating expenses (${periodLabel})`, p.operatingExpenses, name, currency), ...top.map((e) => moneyFact(sanitizeForModel(e.category, 60), e.amount, name, currency))],
    summary:
      top.length === 0
        ? `No operating expenses are recorded for ${periodLabel}.`
        : `Your expenses for ${periodLabel} total ${m(p.operatingExpenses, currency)}. The largest: ${top.slice(0, 3).map((e) => `${e.category} ${m(e.amount, currency)}`).join(", ")}.`,
    gaps: [],
  };
}

// ---------------------------------------------------------------------------
export function presentForecast(result: ForecastResult, assumptions: readonly string[], gaps: readonly DataGap[], today: IsoDate, currency = "GHS"): ToolOutput {
  const name = "get_cash_forecast";
  const days = result.days.length;
  const facts: Fact[] = [
    moneyFact("Cash today", result.openingCash, name, currency),
    moneyFact(`Estimated cash in ${days} days`, result.closingCash, name, currency),
    moneyFact("Lowest projected cash", result.minBalance, name, currency),
    dateFact("Lowest point on", result.minBalanceDate, name),
    moneyFact("Expected money in", result.totalInflow, name, currency),
    moneyFact("Expected money out", result.totalOutflow, name, currency),
  ];
  if (result.firstShortfallDate) facts.push(dateFact("Cash could run out on", result.firstShortfallDate, name));
  if (result.reserve !== null) facts.push(moneyFact("Your minimum cash reserve", result.reserve, name, currency));
  const events = result.included.slice(0, 12);
  for (const e of events) facts.push(moneyFact(`${sanitizeForModel(e.label, 80)} (${formatDate(e.date, { year: false })})`, Math.abs(e.amount), name, currency));
  const uncertain = result.excluded.filter((e) => e.confidence === "uncertain" && e.amount > 0);
  const uncertainTotal = uncertain.reduce((s, e) => s + e.amount, 0);
  if (uncertainTotal > 0) facts.push(moneyFact("Uncertain money not counted (overdue)", uncertainTotal, name, currency));

  let summary = `Starting from ${m(result.openingCash, currency)} today, your cash is estimated at ${m(result.closingCash, currency)} in ${days} days.`;
  if (result.firstShortfallDate) {
    summary += ` Warning: it could fall below zero ${relativeDay(result.firstShortfallDate, today)} (${formatDate(result.firstShortfallDate)}), reaching ${m(result.minBalance, currency)} at the lowest.`;
  } else {
    summary += ` The lowest point is ${m(result.minBalance, currency)} on ${formatDate(result.minBalanceDate)}.`;
  }
  if (uncertainTotal > 0) summary += ` ${m(uncertainTotal, currency)} of overdue customer money is not counted.`;
  summary += " This is an estimate based on recorded bills, planned payments and expected customer payments.";

  return {
    name,
    data: {
      start: result.start,
      end: result.end,
      opening_cash_minor: result.openingCash,
      closing_cash_minor: result.closingCash,
      min_balance_minor: result.minBalance,
      min_balance_date: result.minBalanceDate,
      first_shortfall_date: result.firstShortfallDate,
      reserve_minor: result.reserve,
      upcoming: events.map((e) => ({ date: e.date, label: sanitizeForModel(e.label, 80), amount_minor: e.amount, confidence: e.confidence })),
      uncertain_not_counted_minor: uncertainTotal,
      assumptions: assumptions.slice(0, 8),
    },
    facts,
    summary,
    gaps: gapMessages(gaps),
  };
}

// ---------------------------------------------------------------------------
export function presentSpendSimulation(
  cmp: ScenarioComparison,
  amount: Minor,
  date: IsoDate,
  label: string,
  today: IsoDate,
  currency = "GHS",
): ToolOutput {
  const name = "simulate_spend";
  const s = cmp.scenario;
  const b = cmp.baseline;
  const facts: Fact[] = [
    moneyFact(`Planned spend: ${sanitizeForModel(label, 60)}`, amount, name, currency),
    dateFact("Spend date", date, name),
    moneyFact("Cash today", b.openingCash, name, currency),
    moneyFact("Lowest cash without the spend", b.minBalance, name, currency),
    moneyFact("Lowest cash with the spend", s.minBalance, name, currency),
    dateFact("Lowest point with the spend", s.minBalanceDate, name),
    moneyFact(`Cash in ${s.days.length} days without the spend`, b.closingCash, name, currency),
    moneyFact(`Cash in ${s.days.length} days with the spend`, s.closingCash, name, currency),
  ];
  if (s.firstShortfallDate) {
    facts.push(dateFact("Shortfall starts", s.firstShortfallDate, name));
    facts.push(moneyFact("Size of shortfall", -s.worstShortfall, name, currency));
  }
  if (s.reserve !== null) facts.push(moneyFact("Your minimum cash reserve", s.reserve, name, currency));

  // Find the first inflow that brings the balance back to zero, to explain timing.
  let recovery: ForecastEvent | undefined;
  if (s.firstShortfallDate) {
    const idx = s.days.findIndex((d) => d.date === s.firstShortfallDate);
    const back = s.days.slice(idx).find((d) => d.closing >= 0);
    if (back) recovery = s.included.find((e) => e.date === back.date && e.amount > 0);
    if (recovery) facts.push(moneyFact(`${sanitizeForModel(recovery.label, 80)} (${formatDate(recovery.date, { year: false })})`, recovery.amount, name, currency));
  }

  let verdict: "affordable" | "tight" | "shortfall";
  if (s.firstShortfallDate) verdict = "shortfall";
  else if (s.reserve !== null && s.minBalance < s.reserve) verdict = "tight";
  else verdict = "affordable";

  let summary: string;
  if (verdict === "shortfall") {
    summary = `Spending ${m(amount, currency)} ${relativeDay(date, today)} could leave you short: cash would fall below zero on ${formatDate(s.firstShortfallDate!)} and reach ${m(s.minBalance, currency)} at the lowest.`;
    summary += recovery
      ? ` It recovers when ${sanitizeForModel(recovery.label, 80)} pays ${m(recovery.amount, currency)} on ${formatDate(recovery.date)} — so this is a timing problem.`
      : " Recorded money coming in does not cover it within this period.";
    summary += " You could wait until expected payments arrive, collect a payment early, or buy a smaller amount.";
  } else if (verdict === "tight") {
    summary = `You can afford ${m(amount, currency)} ${relativeDay(date, today)} without going below zero, but cash would drop to ${m(s.minBalance, currency)}, under your ${m(s.reserve!, currency)} safety buffer.`;
  } else {
    summary = `Yes — spending ${m(amount, currency)} ${relativeDay(date, today)} keeps your cash above zero. The lowest point would be ${m(s.minBalance, currency)} on ${formatDate(s.minBalanceDate)}.`;
  }
  summary += " (Estimate based on recorded bills, planned payments and expected customer payments.)";

  return {
    name,
    data: {
      amount_minor: amount,
      date,
      verdict,
      baseline: { min_balance_minor: b.minBalance, min_balance_date: b.minBalanceDate, closing_minor: b.closingCash, first_shortfall_date: b.firstShortfallDate },
      with_spend: { min_balance_minor: s.minBalance, min_balance_date: s.minBalanceDate, closing_minor: s.closingCash, first_shortfall_date: s.firstShortfallDate, shortfall_minor: -s.worstShortfall },
      recovers_with: recovery ? { label: sanitizeForModel(recovery.label, 80), date: recovery.date, amount_minor: recovery.amount } : null,
      reserve_minor: s.reserve,
    },
    facts,
    summary,
    gaps: [],
  };
}

// ---------------------------------------------------------------------------
export function presentScenario(
  scenarioName: string,
  cmp: ScenarioComparison,
  assumptions: readonly string[],
  warnings: readonly string[],
  currency = "GHS",
): ToolOutput {
  const name = "run_saved_scenario";
  const s = cmp.scenario;
  const b = cmp.baseline;
  const facts: Fact[] = [
    textFact("Scenario", sanitizeForModel(scenarioName, 120), name),
    moneyFact("Closing cash (current forecast)", b.closingCash, name, currency),
    moneyFact("Closing cash (scenario)", s.closingCash, name, currency),
    moneyFact("Difference at the end", cmp.closingDifference, name, currency),
    moneyFact("Lowest cash (current forecast)", b.minBalance, name, currency),
    moneyFact("Lowest cash (scenario)", s.minBalance, name, currency),
  ];
  if (s.firstShortfallDate) facts.push(dateFact("Scenario shortfall starts", s.firstShortfallDate, name));
  return {
    name,
    data: {
      scenario: sanitizeForModel(scenarioName, 120),
      baseline: { closing_minor: b.closingCash, min_balance_minor: b.minBalance, first_shortfall_date: b.firstShortfallDate },
      scenario_result: { closing_minor: s.closingCash, min_balance_minor: s.minBalance, min_balance_date: s.minBalanceDate, first_shortfall_date: s.firstShortfallDate },
      closing_difference_minor: cmp.closingDifference,
      assumptions,
      warnings,
    },
    facts,
    summary:
      `In "${sanitizeForModel(scenarioName, 120)}", cash ends at ${m(s.closingCash, currency)} versus ${m(b.closingCash, currency)} in your current forecast, and the lowest point is ${m(s.minBalance, currency)}` +
      (s.firstShortfallDate ? `, with a shortfall from ${formatDate(s.firstShortfallDate)}.` : " with no shortfall.") +
      (cmp.resolvesShortfall ? " This scenario avoids the shortfall in your current forecast." : ""),
    gaps: [...warnings],
  };
}
