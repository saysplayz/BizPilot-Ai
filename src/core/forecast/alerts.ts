// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * Alert derivation. Each alert has a fingerprint built only from the values
 * that make it materially different (date, amount rounded to GH₵100, the set
 * of documents involved). The database keeps one row per fingerprint, so an
 * unchanged situation is never re-announced and a dismissed alert stays
 * dismissed until something meaningful changes.
 */
import { addDays, diffDays, formatDate, type IsoDate } from "../dates";
import { expenseSpike } from "../finance/metrics";
import { formatMoney, type Minor } from "../money";
import type { ForecastResult } from "./types";

export type AlertSeverity = "info" | "warning" | "critical";

export interface DerivedAlert {
  kind:
    | "cash_shortfall"
    | "below_reserve"
    | "bills_before_collections"
    | "overdue_receivables"
    | "upcoming_obligations"
    | "high_expenses"
    | "collections_missed"
    | "low_stock";
  severity: AlertSeverity;
  title: string;
  message: string;
  fingerprint: string;
  data: Record<string, unknown>;
}

export interface AlertInputs {
  today: IsoDate;
  currency?: string;
  forecast: ForecastResult;
  receivables: { invoice_id: string; customer_name: string; due_date: IsoDate; outstanding_minor: Minor }[];
  payables: { bill_id: string; supplier_name: string; due_date: IsoDate; outstanding_minor: Minor }[];
  /** Operating expenses in the last 30 days vs the 30 days before. */
  expenses: { current: Minor; previous: Minor | null };
  lowStock: { product_id: string; name: string; quantity_on_hand: number }[];
}

/** Round to the nearest GH₵100 so small changes don't create "new" alerts. */
const bucket = (m: Minor) => Math.round(m / 10_000);

export function deriveAlerts(input: AlertInputs): DerivedAlert[] {
  const money = (m: Minor) => formatMoney(m, { currency: input.currency ?? "GHS" });
  const { forecast, today } = input;
  const alerts: DerivedAlert[] = [];

  // 1. Projected negative balance.
  if (forecast.firstShortfallDate) {
    const date = forecast.firstShortfallDate;
    alerts.push({
      kind: "cash_shortfall",
      severity: "critical",
      title: `You may run short of cash ${diffDays(today, date) <= 0 ? "today" : `on ${formatDate(date, { year: false })}`}`,
      message: `Based on recorded bills, planned payments and expected collections, cash could fall to ${money(forecast.worstShortfall)} by ${formatDate(forecast.minBalanceDate)}. This is an estimate, not a certainty.`,
      fingerprint: `cash_shortfall:${date}:${bucket(forecast.worstShortfall)}`,
      data: { date, worst: forecast.worstShortfall, min_date: forecast.minBalanceDate },
    });
  } else if (forecast.firstBelowReserveDate && forecast.reserve !== null) {
    // 2. Below the owner's safety buffer (only when not already negative).
    const date = forecast.firstBelowReserveDate;
    alerts.push({
      kind: "below_reserve",
      severity: "warning",
      title: `Cash may dip below your ${money(forecast.reserve)} safety buffer`,
      message: `Projected cash drops to ${money(forecast.minBalance)} on ${formatDate(forecast.minBalanceDate)}, below the minimum reserve you set.`,
      fingerprint: `below_reserve:${date}:${bucket(forecast.minBalance)}`,
      data: { date, min: forecast.minBalance, reserve: forecast.reserve },
    });
  }

  // 3. Bills due before the money to pay them arrives.
  const included = forecast.included;
  const nextCollection = included
    .filter((e) => e.amount > 0 && e.category === "customer_collection")
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (nextCollection) {
    const dueFirst = included.filter(
      (e) => e.amount < 0 && e.date < nextCollection.date && (e.category === "supplier_payment" || e.category === "planned_expense"),
    );
    const dueTotal = dueFirst.reduce((s, e) => s - e.amount, 0);
    const lowestBeforeCollection = forecast.days
      .filter((d) => d.date < nextCollection.date)
      .reduce((m, d) => Math.min(m, d.closing), forecast.openingCash);
    const buffer = forecast.reserve ?? 0;
    if (dueFirst.length > 0 && lowestBeforeCollection < buffer) {
      alerts.push({
        kind: "bills_before_collections",
        severity: "warning",
        title: "Bills are due before your expected customer payments",
        message: `${money(dueTotal)} in bills and planned payments falls due before ${nextCollection.label} pays on ${formatDate(nextCollection.date)}. Consider collecting early or agreeing new dates with suppliers.`,
        fingerprint: `bills_before_collections:${nextCollection.ref}:${dueFirst.map((e) => e.ref).sort().join(",")}`,
        data: { refs: dueFirst.map((e) => e.ref), collection: nextCollection.ref },
      });
    }
  }

  // 4. Overdue customer debts.
  const overdue = input.receivables.filter((r) => r.due_date < today && r.outstanding_minor > 0);
  if (overdue.length > 0) {
    const total = overdue.reduce((s, r) => s + r.outstanding_minor, 0);
    alerts.push({
      kind: "overdue_receivables",
      severity: "warning",
      title: `${overdue.length} customer payment${overdue.length === 1 ? " is" : "s are"} overdue`,
      message: `${money(total)} is overdue${overdue.length === 1 ? ` from ${overdue[0]!.customer_name}` : ""}. Overdue money is not counted in your main forecast.`,
      fingerprint: `overdue_receivables:${overdue.map((r) => r.invoice_id).sort().join(",")}:${bucket(total)}`,
      data: { count: overdue.length, total },
    });
  }

  // 5. Money expected in the past week that did not arrive (forecast vs actual).
  const missed = input.receivables.filter((r) => r.due_date < today && r.due_date >= addDays(today, -7));
  if (missed.length > 0) {
    const total = missed.reduce((s, r) => s + r.outstanding_minor, 0);
    alerts.push({
      kind: "collections_missed",
      severity: "info",
      title: "Expected payments did not arrive this week",
      message: `The forecast expected ${money(total)} from customers in the last 7 days that has not been recorded as received. Your forecast has been updated to treat it as uncertain.`,
      fingerprint: `collections_missed:${missed.map((r) => r.invoice_id).sort().join(",")}`,
      data: { total, count: missed.length },
    });
  }

  // 6. Supplier obligations in the next 7 days.
  const soon = input.payables.filter((p) => p.due_date >= today && p.due_date <= addDays(today, 7));
  if (soon.length > 0) {
    const total = soon.reduce((s, p) => s + p.outstanding_minor, 0);
    alerts.push({
      kind: "upcoming_obligations",
      severity: "info",
      title: `${money(total)} due to suppliers in the next 7 days`,
      message: soon.map((p) => `${p.supplier_name}: ${money(p.outstanding_minor)} on ${formatDate(p.due_date, { year: false })}`).join("; "),
      fingerprint: `upcoming_obligations:${soon.map((p) => p.bill_id).sort().join(",")}:${bucket(total)}`,
      data: { total, count: soon.length },
    });
  }

  // 7. Unusually high spending.
  const spike = expenseSpike(input.expenses.current, input.expenses.previous);
  if (spike.isSpike && spike.ratio !== null) {
    alerts.push({
      kind: "high_expenses",
      severity: "warning",
      title: "Spending is higher than usual",
      message: `Operating expenses in the last 30 days were ${money(input.expenses.current)}, about ${Math.round((spike.ratio - 1) * 100)}% more than the previous 30 days (${money(input.expenses.previous ?? 0)}).`,
      fingerprint: `high_expenses:${today.slice(0, 7)}:${bucket(input.expenses.current)}`,
      data: { current: input.expenses.current, previous: input.expenses.previous },
    });
  }

  // 8. Low stock.
  if (input.lowStock.length > 0) {
    alerts.push({
      kind: "low_stock",
      severity: "info",
      title: `${input.lowStock.length} product${input.lowStock.length === 1 ? " is" : "s are"} running low`,
      message: input.lowStock.slice(0, 5).map((p) => `${p.name} (${p.quantity_on_hand} left)`).join(", "),
      fingerprint: `low_stock:${input.lowStock.map((p) => p.product_id).sort().join(",")}`,
      data: { count: input.lowStock.length },
    });
  }

  return alerts;
}
