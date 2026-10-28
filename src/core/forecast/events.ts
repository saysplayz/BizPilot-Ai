// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * Builds the dated list of future cash movements from recorded data.
 *
 * Double-counting rules (the forecast's core guarantees):
 *   * Only OPEN invoices/bills contribute, and only their OUTSTANDING amount.
 *     Money already received/paid is in today's cash balance, never again.
 *   * A sale's revenue is never a cash event; only the collection is.
 *   * A bill is a cash outflow once, when it is expected to be paid — not at
 *     creation and again at payment.
 *   * A planned payment occurrence that was settled by a real transaction is
 *     skipped.
 *
 * Conservative timing assumptions (documented, shown to users):
 *   * Money owed TO the business that is overdue is "uncertain": excluded from
 *     the main forecast rather than assumed to arrive immediately.
 *   * Money the business OWES that is overdue is assumed to be paid today.
 */
import { addDays, addMonths, diffDays, formatDate, type IsoDate } from "../dates";
import type { DataGap } from "../finance/types";
import { formatMoney, mulRatio, type Minor } from "../money";
import type { BaselineForecast, ForecastEvent, ForecastInputs, ForecastOptions } from "./types";

/** How far back to look for unpaid occurrences of planned payments. */
export const PLANNED_LOOKBACK_DAYS = 31;
/** Minimum history before we offer sales projections. */
export const MIN_HISTORY_DAYS_FOR_PROJECTION = 14;
/** Overdue receivables, if counted, are assumed collected this many days from today. */
export const OVERDUE_COLLECTION_DAYS = 7;

export function expandOccurrences(
  ev: { start_date: IsoDate; recurrence: "none" | "weekly" | "monthly"; end_date: IsoDate | null },
  from: IsoDate,
  to: IsoDate,
): IsoDate[] {
  const out: IsoDate[] = [];
  const anchorDay = Number(ev.start_date.slice(8, 10));
  for (let i = 0, d = ev.start_date; d <= to && i < 1000; i++) {
    if (ev.end_date && d > ev.end_date) break;
    if (d >= from) out.push(d);
    if (ev.recurrence === "none") break;
    d = ev.recurrence === "weekly" ? addDays(ev.start_date, 7 * (i + 1)) : addMonths(ev.start_date, i + 1, anchorDay);
  }
  return out;
}

export function buildBaselineEvents(inputs: ForecastInputs, opts: ForecastOptions): BaselineForecast {
  const { today, horizonDays } = opts;
  const end = addDays(today, horizonDays - 1);
  const currency = inputs.business.currency;
  const money = (m: Minor) => formatMoney(m, { currency });
  const events: ForecastEvent[] = [];
  const assumptions: string[] = [];
  const gaps: DataGap[] = [];

  // Customer collections.
  for (const inv of inputs.open_invoices) {
    if (inv.outstanding_minor <= 0) continue;
    const overdueDays = diffDays(inv.due_date, today);
    if (overdueDays > 0) {
      events.push({
        ref: `invoice:${inv.id}`,
        date: addDays(today, OVERDUE_COLLECTION_DAYS),
        amount: inv.outstanding_minor,
        label: `${inv.customer_name} (${inv.number}, overdue)`,
        category: "customer_collection",
        confidence: "uncertain",
        source: { type: "invoice", id: inv.id },
        assumption: `${inv.customer_name} is ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue on ${money(inv.outstanding_minor)}. Not counted unless you include uncertain money.`,
      });
    } else if (inv.due_date <= end) {
      events.push({
        ref: `invoice:${inv.id}`,
        date: inv.due_date,
        amount: inv.outstanding_minor,
        label: `${inv.customer_name} (${inv.number})`,
        category: "customer_collection",
        confidence: "expected",
        source: { type: "invoice", id: inv.id },
        assumption: `Assumes ${inv.customer_name} pays ${money(inv.outstanding_minor)} on the due date, ${formatDate(inv.due_date)}.`,
      });
    }
  }

  // Supplier bills.
  for (const bill of inputs.open_bills) {
    if (bill.outstanding_minor <= 0) continue;
    const overdue = bill.due_date < today;
    if (!overdue && bill.due_date > end) continue;
    events.push({
      ref: `bill:${bill.id}`,
      date: overdue ? today : bill.due_date,
      amount: -bill.outstanding_minor,
      label: `${bill.supplier_name} (${bill.number}${overdue ? ", overdue" : ""})`,
      category: "supplier_payment",
      confidence: "scheduled",
      source: { type: "bill", id: bill.id },
      assumption: overdue
        ? `Bill ${bill.number} was due ${formatDate(bill.due_date)}; assumed paid today.`
        : `Assumes bill ${bill.number} is paid on its due date, ${formatDate(bill.due_date)}.`,
    });
  }

  // Planned payments / income.
  const lookback = addDays(today, -PLANNED_LOOKBACK_DAYS);
  for (const ev of inputs.scheduled_events) {
    const settled = new Set(ev.settled_dates);
    for (const occ of expandOccurrences(ev, lookback, end)) {
      if (settled.has(occ)) continue;
      const pastDue = occ < today;
      const out = ev.direction === "out";
      if (pastDue && !out) {
        events.push({
          ref: `scheduled:${ev.id}:${occ}`,
          date: addDays(today, OVERDUE_COLLECTION_DAYS),
          amount: ev.amount_minor,
          label: `${ev.label} (expected ${formatDate(occ, { year: false })}, not received)`,
          category: "planned_income",
          confidence: "uncertain",
          source: { type: "scheduled", id: ev.id },
          assumption: `${ev.label} was expected on ${formatDate(occ)} but has not been recorded as received.`,
        });
        continue;
      }
      events.push({
        ref: `scheduled:${ev.id}:${occ}`,
        date: pastDue ? today : occ,
        amount: out ? -ev.amount_minor : ev.amount_minor,
        label: pastDue ? `${ev.label} (due ${formatDate(occ, { year: false })}, unpaid)` : ev.label,
        category: out ? (ev.category === "Loan repayment" ? "loan_repayment" : "planned_expense") : "planned_income",
        confidence: ev.confidence,
        source: { type: "scheduled", id: ev.id },
        assumption: pastDue
          ? `${ev.label} was due ${formatDate(occ)} and is not recorded as paid; assumed paid today.`
          : `Planned ${out ? "payment" : "income"}: ${ev.label}, ${money(ev.amount_minor)} on ${formatDate(occ)}.`,
      });
    }
  }

  // Optional projection from recent sales (always "uncertain").
  const proj = salesProjection(inputs, today);
  if (opts.includeProjectedSales) {
    if (proj.available) {
      events.push(...projectionEvents(proj, today, end, 1));
      assumptions.push(
        `Projected sales assume your average cash sales from the last ${proj.days} days (${money(proj.dailySales)} a day) continue, along with typical stock spending (${money(proj.dailyPurchases)} a day). Past sales do not guarantee future sales.`,
      );
    } else {
      assumptions.push(proj.reason);
    }
  }

  // Data gaps that make the forecast incomplete.
  if (!inputs.business.opening_balance_set) {
    gaps.push({
      code: "no_opening_balance",
      message: "Opening cash balance is not recorded, so the forecast starts from recorded movements only.",
    });
  }
  if (inputs.open_bills.length === 0 && inputs.scheduled_events.length === 0) {
    gaps.push({
      code: "no_upcoming_obligations",
      message:
        "No upcoming bills or planned payments (rent, wages, loan repayments) are recorded. Add them so the forecast does not look better than reality.",
    });
  }
  if (inputs.future_dated_cash_minor !== 0) {
    gaps.push({
      code: "future_dated_records",
      message: "Some records are dated in the future; they are not included in today's cash.",
    });
  }

  assumptions.unshift(
    `Starts from cash recorded today: ${money(inputs.cash_balance_minor)}.`,
    "Customers who are not yet overdue are assumed to pay on their due date.",
    "Overdue customer debts are treated as uncertain and are not counted by default.",
    "Overdue bills and planned payments are assumed to be paid today.",
  );

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
  return { events, assumptions, gaps };
}

export interface SalesProjection {
  available: boolean;
  reason: string;
  days: number;
  dailySales: Minor;
  dailyPurchases: Minor;
}

export function salesProjection(inputs: ForecastInputs, today: IsoDate): SalesProjection {
  const t = inputs.trailing_sales;
  const historyDays = t.first_txn_date ? diffDays(t.first_txn_date, today) + 1 : 0;
  if (historyDays < MIN_HISTORY_DAYS_FOR_PROJECTION || t.cash_sales_minor <= 0) {
    return {
      available: false,
      reason: `Sales projections need at least ${MIN_HISTORY_DAYS_FOR_PROJECTION} days of recorded cash sales.`,
      days: 0,
      dailySales: 0,
      dailyPurchases: 0,
    };
  }
  const days = Math.min(t.days, historyDays);
  return {
    available: true,
    reason: "",
    days,
    dailySales: mulRatio(t.cash_sales_minor, 1, days),
    dailyPurchases: mulRatio(t.stock_purchases_minor, 1, days),
  };
}

/** Daily projected sales (+) and stock purchases (−), scaled by salesFactor (1 = unchanged). */
export function projectionEvents(
  proj: SalesProjection,
  from: IsoDate,
  to: IsoDate,
  salesFactorNumerator: number,
  salesFactorDenominator = 1,
  purchaseFactorNumerator = 1,
  purchaseFactorDenominator = 1,
): ForecastEvent[] {
  if (!proj.available) return [];
  const out: ForecastEvent[] = [];
  // Start tomorrow: today's sales are already being recorded.
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    const sales = mulRatio(proj.dailySales, salesFactorNumerator, salesFactorDenominator);
    if (sales > 0) {
      out.push({
        ref: `sales:${d}`,
        date: d,
        amount: sales,
        label: "Projected cash sales",
        category: "projected_sales",
        confidence: "uncertain",
        source: { type: "projection" },
      });
    }
    const purchases = mulRatio(proj.dailyPurchases, purchaseFactorNumerator, purchaseFactorDenominator);
    if (purchases > 0) {
      out.push({
        ref: `purchases:${d}`,
        date: d,
        amount: -purchases,
        label: "Projected stock spending",
        category: "projected_purchases",
        confidence: "uncertain",
        source: { type: "projection" },
      });
    }
  }
  return out;
}
