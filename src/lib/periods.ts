// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import { addDays, addMonths, diffDays, endOfMonth, formatDate, isIsoDate, startOfMonth, type IsoDate } from "@/core/dates";
import type { Period } from "@/core/finance/types";

export const PERIOD_PRESETS = ["today", "this_week", "this_month", "last_month", "last_30_days", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface ResolvedPeriod extends Period {
  preset: PeriodPreset;
  label: string;
}

/** Monday-start week, as most Ghanaian shops count it. */
function startOfWeek(date: IsoDate): IsoDate {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

export function resolvePeriod(preset: string | undefined, today: IsoDate, custom?: { from?: string; to?: string }): ResolvedPeriod {
  switch (preset) {
    case "today":
      return { preset: "today", from: today, to: today, label: "today" };
    case "this_week":
      return { preset: "this_week", from: startOfWeek(today), to: today, label: "this week" };
    case "last_month": {
      const from = addMonths(startOfMonth(today), -1);
      return { preset: "last_month", from, to: endOfMonth(from), label: "last month" };
    }
    case "last_30_days":
      return { preset: "last_30_days", from: addDays(today, -29), to: today, label: "the last 30 days" };
    case "custom": {
      if (custom?.from && custom?.to && isIsoDate(custom.from) && isIsoDate(custom.to) && custom.from <= custom.to && diffDays(custom.from, custom.to) <= 731) {
        return { preset: "custom", from: custom.from, to: custom.to, label: `${formatDate(custom.from)} – ${formatDate(custom.to)}` };
      }
      return resolvePeriod("this_month", today);
    }
    case "this_month":
    default:
      return { preset: "this_month", from: startOfMonth(today), to: today, label: "this month" };
  }
}

/** The same number of days at the start of last month (for fair month-to-date comparisons). */
export function previousComparablePeriod(today: IsoDate): Period {
  const thisStart = startOfMonth(today);
  const lastStart = addMonths(thisStart, -1);
  const elapsed = diffDays(thisStart, today);
  const lastEnd = endOfMonth(lastStart);
  const to = addDays(lastStart, elapsed);
  return { from: lastStart, to: to > lastEnd ? lastEnd : to };
}
