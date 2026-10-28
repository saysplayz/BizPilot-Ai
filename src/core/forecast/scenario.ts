// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * What-if scenarios. Pure functions: a scenario is a list of adjustments
 * applied IN MEMORY to a copy of the baseline events. Nothing here can touch
 * recorded financial data.
 */
import { addDays, addMonths, formatDate, type IsoDate } from "../dates";
import { applyPercentChange, formatMoney, type Minor } from "../money";
import type { ScenarioAdjustment } from "../validation/scenario";
import { computeForecast, type ComputeOptions } from "./engine";
import { projectionEvents, type SalesProjection } from "./events";
import type { ForecastEvent, ForecastResult } from "./types";

export interface ScenarioContext {
  today: IsoDate;
  horizonDays: number;
  currency?: string;
  /** Sales projection from history (needed for sales_change_pct). */
  projection: SalesProjection;
  /** Whether the baseline already includes projected sales events. */
  baselineHasProjection: boolean;
}

export interface AppliedScenario {
  events: ForecastEvent[];
  assumptions: string[];
  warnings: string[];
}

function resolveDate(today: IsoDate, v: { date?: string; day_offset?: number }): IsoDate {
  return v.date ?? addDays(today, v.day_offset ?? 0);
}

/** Future stock purchases a supplier price change would affect (not bills already issued). */
function isFutureStockPurchase(ev: ForecastEvent): boolean {
  if (ev.amount >= 0) return false;
  if (ev.category === "projected_purchases") return true;
  if (ev.category === "scenario") return /stock/i.test(ev.tag ?? "") || /stock/i.test(ev.label);
  return false;
}

export function applyScenario(
  baseline: readonly ForecastEvent[],
  adjustments: readonly ScenarioAdjustment[],
  ctx: ScenarioContext,
  /** Inventory bills are supplier stock payments; passed so price changes can target them. */
  inventoryBillRefs: ReadonlySet<string> = new Set(),
): AppliedScenario {
  const money = (m: Minor) => formatMoney(m, { currency: ctx.currency ?? "GHS" });
  const end = addDays(ctx.today, ctx.horizonDays - 1);
  let events: ForecastEvent[] = baseline.map((e) => ({ ...e }));
  const assumptions: string[] = [];
  const warnings: string[] = [];

  // Sales change needs a projection stream; add one if the baseline has none.
  const salesChange = adjustments.find((a) => a.kind === "sales_change_pct");
  if (salesChange && !ctx.baselineHasProjection) {
    if (ctx.projection.available) {
      events.push(...projectionEvents(ctx.projection, ctx.today, end, 1));
      assumptions.push(
        `To model a change in sales, recent average cash sales (${money(ctx.projection.dailySales)} a day) and stock spending (${money(ctx.projection.dailyPurchases)} a day) are projected forward.`,
      );
    } else {
      warnings.push(`${ctx.projection.reason} The sales change was not applied.`);
    }
  }

  adjustments.forEach((adj, index) => {
    switch (adj.kind) {
      case "one_off": {
        const date = resolveDate(ctx.today, adj);
        events.push({
          ref: `scenario:${index}`,
          date,
          amount: adj.direction === "in" ? adj.amount_minor : -adj.amount_minor,
          label: adj.label,
          category: "scenario",
          confidence: "scheduled",
          source: { type: "scenario" },
          tag: adj.category,
          assumption: `${adj.label}: ${adj.direction === "in" ? "receive" : "spend"} ${money(adj.amount_minor)} on ${formatDate(date)}.`,
        });
        assumptions.push(`${adj.direction === "in" ? "Receive" : "Spend"} ${money(adj.amount_minor)} on ${formatDate(date)} (${adj.label}).`);
        break;
      }
      case "recurring": {
        const start = adj.start_date ?? addDays(ctx.today, adj.start_offset ?? 0);
        const anchor = Number(start.slice(8, 10));
        let count = 0;
        for (let i = 0, d = start; d <= end && i < 400; i++) {
          if (d >= ctx.today) {
            events.push({
              ref: `scenario:${index}:${d}`,
              date: d,
              amount: adj.direction === "in" ? adj.amount_minor : -adj.amount_minor,
              label: adj.label,
              category: "scenario",
              confidence: "scheduled",
              source: { type: "scenario" },
              tag: adj.category,
            });
            count++;
          }
          d = adj.interval === "weekly" ? addDays(start, 7 * (i + 1)) : addMonths(start, i + 1, anchor);
        }
        assumptions.push(
          `${adj.label}: ${money(adj.amount_minor)} ${adj.interval === "weekly" ? "every week" : "every month"} from ${formatDate(start)} (${count} payment${count === 1 ? "" : "s"} in this period).`,
        );
        break;
      }
      case "delay_event": {
        const targets = events.filter((e) => e.ref === adj.event_ref || e.ref.startsWith(`${adj.event_ref}:`));
        if (targets.length === 0) {
          warnings.push("The payment you chose to delay is no longer in the forecast.");
          break;
        }
        events = events.map((e) =>
          targets.includes(e) ? { ...e, date: addDays(e.date < ctx.today ? ctx.today : e.date, adj.days) } : e,
        );
        assumptions.push(`${targets[0]!.label} moves ${adj.days} day${adj.days === 1 ? "" : "s"} later.`);
        break;
      }
      case "collect_early": {
        const ref = `invoice:${adj.invoice_id}`;
        const target = events.find((e) => e.ref === ref);
        if (!target) {
          warnings.push("That invoice is no longer outstanding.");
          break;
        }
        const date = resolveDate(ctx.today, adj);
        events = events.map((e) =>
          e.ref === ref ? { ...e, date, confidence: "expected", assumption: `Customer agrees to pay on ${formatDate(date)}.` } : e,
        );
        assumptions.push(`${target.label} pays ${money(target.amount)} on ${formatDate(date)} instead of ${formatDate(target.date)}.`);
        break;
      }
      case "sales_change_pct": {
        let touched = 0;
        events = events.map((e) => {
          if (e.category !== "projected_sales") return e;
          touched++;
          return { ...e, amount: applyPercentChange(e.amount, adj.pct) };
        });
        if (touched > 0) {
          assumptions.push(`Cash sales are ${Math.abs(adj.pct)}% ${adj.pct < 0 ? "lower" : "higher"} than recent average.`);
        }
        break;
      }
      case "supplier_price_change_pct": {
        let touched = 0;
        events = events.map((e) => {
          // Bills already received keep their agreed prices; only future purchases change.
          if (inventoryBillRefs.has(e.ref) || !isFutureStockPurchase(e)) return e;
          touched++;
          return { ...e, amount: applyPercentChange(e.amount, adj.pct) };
        });
        if (touched > 0) {
          assumptions.push(`Future stock purchases cost ${Math.abs(adj.pct)}% ${adj.pct < 0 ? "less" : "more"}. Bills already received keep their agreed prices.`);
        } else {
          warnings.push("There are no future stock purchases in this scenario for a price change to affect. Add a stock purchase or turn on projected sales.");
        }
        break;
      }
      case "exclude_event": {
        const target = events.find((e) => e.ref === adj.event_ref);
        if (!target) {
          warnings.push("The item you chose to remove is no longer in the forecast.");
          break;
        }
        events = events.filter((e) => e.ref !== adj.event_ref);
        assumptions.push(`${target.label} (${money(Math.abs(target.amount))}) does not happen.`);
        break;
      }
    }
  });

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
  return { events, assumptions, warnings };
}

export interface ScenarioComparison {
  baseline: ForecastResult;
  scenario: ForecastResult;
  closingDifference: Minor;
  minBalanceDifference: Minor;
  /** True when the scenario creates a shortfall the baseline does not have. */
  createsShortfall: boolean;
  /** True when the scenario removes a shortfall the baseline has. */
  resolvesShortfall: boolean;
  series: { date: IsoDate; baseline: Minor; scenario: Minor }[];
}

export function compareScenario(
  openingCash: Minor,
  baselineEvents: readonly ForecastEvent[],
  scenarioEvents: readonly ForecastEvent[],
  opts: ComputeOptions,
): ScenarioComparison {
  const baseline = computeForecast(openingCash, baselineEvents, opts);
  const scenario = computeForecast(openingCash, scenarioEvents, opts);
  return {
    baseline,
    scenario,
    closingDifference: scenario.closingCash - baseline.closingCash,
    minBalanceDifference: scenario.minBalance - baseline.minBalance,
    createsShortfall: scenario.firstShortfallDate !== null && baseline.firstShortfallDate === null,
    resolvesShortfall: scenario.firstShortfallDate === null && baseline.firstShortfallDate !== null,
    series: baseline.days.map((d, i) => ({ date: d.date, baseline: d.closing, scenario: scenario.days[i]?.closing ?? d.closing })),
  };
}
