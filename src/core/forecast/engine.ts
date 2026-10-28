// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * Day-by-day cash projection:
 *   closing(day) = closing(day − 1) + inflows(day) − outflows(day)
 *   closing(day −1 of the first day) = cash recorded today (opening).
 * Events dated before the start are clamped to the start (they are due now).
 */
import { addDays, type IsoDate } from "../dates";
import { assertMinor, type Minor } from "../money";
import type { Confidence, ForecastDay, ForecastEvent, ForecastResult } from "./types";

export interface ComputeOptions {
  start: IsoDate;
  horizonDays: number;
  reserve?: Minor | null;
  /** Include overdue receivables and other "uncertain" money. Projections are included whenever present (they are opt-in). */
  includeUncertain?: boolean;
}

export const HORIZONS = [7, 14, 30, 60, 90] as const;
export type Horizon = (typeof HORIZONS)[number];

export function isIncluded(ev: ForecastEvent, includeUncertain: boolean): boolean {
  if (ev.confidence !== "uncertain") return true;
  if (ev.category === "projected_sales" || ev.category === "projected_purchases") return true;
  return includeUncertain;
}

export function computeForecast(openingCash: Minor, events: readonly ForecastEvent[], opts: ComputeOptions): ForecastResult {
  assertMinor(openingCash, "opening cash");
  if (!Number.isInteger(opts.horizonDays) || opts.horizonDays < 1 || opts.horizonDays > 366) {
    throw new RangeError("Forecast horizon must be between 1 and 366 days");
  }
  const start = opts.start;
  const end = addDays(start, opts.horizonDays - 1);
  const includeUncertain = opts.includeUncertain ?? false;
  const reserve = opts.reserve ?? null;

  const included: ForecastEvent[] = [];
  const excluded: ForecastEvent[] = [];
  const byDate = new Map<IsoDate, ForecastEvent[]>();

  for (const raw of events) {
    assertMinor(raw.amount, "event amount");
    if (raw.date > end || !isIncluded(raw, includeUncertain)) {
      excluded.push(raw);
      continue;
    }
    const ev = raw.date < start ? { ...raw, date: start } : raw;
    included.push(ev);
    const list = byDate.get(ev.date) ?? [];
    list.push(ev);
    byDate.set(ev.date, list);
  }

  const days: ForecastDay[] = [];
  let balance = openingCash;
  let minBalance = openingCash;
  let minBalanceDate = start;
  let firstShortfallDate: IsoDate | null = openingCash < 0 ? start : null;
  let firstBelowReserveDate: IsoDate | null = reserve !== null && openingCash < reserve ? start : null;
  let totalInflow = 0;
  let totalOutflow = 0;

  for (let i = 0; i < opts.horizonDays; i++) {
    const date = addDays(start, i);
    const todays = byDate.get(date) ?? [];
    let inflow = 0;
    let outflow = 0;
    for (const ev of todays) {
      if (ev.amount >= 0) inflow += ev.amount;
      else outflow += -ev.amount;
    }
    balance = balance + inflow - outflow;
    totalInflow += inflow;
    totalOutflow += outflow;
    days.push({ date, inflow, outflow, closing: balance, refs: todays.map((e) => e.ref) });

    if (balance < minBalance) {
      minBalance = balance;
      minBalanceDate = date;
    }
    if (balance < 0 && firstShortfallDate === null) firstShortfallDate = date;
    if (reserve !== null && balance < reserve && firstBelowReserveDate === null) firstBelowReserveDate = date;
  }

  const includedConfidence: Confidence[] = includeUncertain
    ? ["confirmed", "scheduled", "expected", "uncertain"]
    : ["confirmed", "scheduled", "expected"];

  return {
    start,
    end,
    openingCash,
    closingCash: balance,
    totalInflow,
    totalOutflow,
    minBalance,
    minBalanceDate,
    firstShortfallDate,
    worstShortfall: Math.min(0, minBalance),
    firstBelowReserveDate,
    reserve,
    days,
    included,
    excluded,
    includedConfidence,
  };
}

/** Summed included amounts by confidence — shown next to the chart. */
export function totalsByConfidence(result: ForecastResult): Record<Confidence, { inflow: Minor; outflow: Minor }> {
  const out: Record<Confidence, { inflow: Minor; outflow: Minor }> = {
    confirmed: { inflow: 0, outflow: 0 },
    scheduled: { inflow: 0, outflow: 0 },
    expected: { inflow: 0, outflow: 0 },
    uncertain: { inflow: 0, outflow: 0 },
  };
  for (const ev of result.included) {
    if (ev.amount >= 0) out[ev.confidence].inflow += ev.amount;
    else out[ev.confidence].outflow += -ev.amount;
  }
  return out;
}
