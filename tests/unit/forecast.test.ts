// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays } from "../../src/core/dates";
import { computeForecast } from "../../src/core/forecast/engine";
import { buildBaselineEvents, expandOccurrences } from "../../src/core/forecast/events";
import type { ForecastInputs } from "../../src/core/forecast/types";
import { demoInputs } from "../fixtures/demo";

const today = "2026-10-28";

function emptyInputs(over: Partial<ForecastInputs> = {}): ForecastInputs {
  return {
    ...demoInputs(today),
    open_invoices: [],
    open_bills: [],
    scheduled_events: [],
    trailing_sales: { days: 28, cash_sales_minor: 0, credit_sales_minor: 0, stock_purchases_minor: 0, first_txn_date: null },
    ...over,
  };
}

describe("10. forecast dates and balances", () => {
  it("projects the demo story day by day", () => {
    const inputs = demoInputs(today);
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
    const f = computeForecast(inputs.cash_balance_minor, events, { start: today, horizonDays: 30, reserve: 50_000 });

    const closing = (offset: number) => f.days[offset]!.closing;
    assert.equal(f.days.length, 30);
    assert.equal(f.days[0]!.date, today);
    assert.equal(closing(0), 300_000);
    assert.equal(closing(2), 300_000);
    assert.equal(closing(3), 200_000); // rent
    assert.equal(closing(5), 50_000); // supplier bill
    assert.equal(closing(10), 250_000); // Ama pays
    assert.equal(f.minBalance, 50_000);
    assert.equal(f.minBalanceDate, addDays(today, 5));
    assert.equal(f.firstShortfallDate, null);
    assert.equal(f.firstBelowReserveDate, null); // exactly at reserve is not below
    // Rent recurs monthly: next occurrence on day 34 is outside a 30-day horizon.
    assert.equal(f.closingCash, 250_000);
  });

  it("closing = opening + inflows − outflows for every day", () => {
    const inputs = demoInputs(today);
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 60 });
    const f = computeForecast(inputs.cash_balance_minor, events, { start: today, horizonDays: 60, includeUncertain: true });
    let running = f.openingCash;
    for (const d of f.days) {
      running = running + d.inflow - d.outflow;
      assert.equal(d.closing, running, `day ${d.date}`);
    }
    assert.equal(f.closingCash, f.openingCash + f.totalInflow - f.totalOutflow);
  });

  it("supports 7/14/30/60/90 day horizons", () => {
    const inputs = demoInputs(today);
    for (const h of [7, 14, 30, 60, 90]) {
      const { events } = buildBaselineEvents(inputs, { today, horizonDays: h });
      const f = computeForecast(inputs.cash_balance_minor, events, { start: today, horizonDays: h });
      assert.equal(f.days.length, h);
      assert.equal(f.end, addDays(today, h - 1));
    }
  });
});

describe("forecast never double counts", () => {
  it("uses only the outstanding part of a partly paid invoice (paid part is already in cash)", () => {
    const inputs = emptyInputs({
      cash_balance_minor: 10_000,
      open_invoices: [{ id: "i1", number: "INV-1", customer_id: "c", customer_name: "Kojo", issue_date: today, due_date: addDays(today, 3), outstanding_minor: 4_000 }],
    });
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 7 });
    const inflows = events.filter((e) => e.amount > 0);
    assert.equal(inflows.length, 1, "one collection event per invoice");
    assert.equal(inflows[0]!.amount, 4_000);
    const f = computeForecast(10_000, events, { start: today, horizonDays: 7 });
    assert.equal(f.closingCash, 14_000);
  });

  it("counts a supplier bill as a single outflow when due (not at creation and again at payment)", () => {
    const inputs = emptyInputs({
      open_bills: [{ id: "b1", number: "BILL-1", supplier_id: "s", supplier_name: "Sup", kind: "expense", due_date: addDays(today, 2), outstanding_minor: 9_000 }],
    });
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 7 });
    assert.equal(events.filter((e) => e.amount < 0).length, 1);
    assert.equal(events[0]!.amount, -9_000);
  });

  it("skips planned payments already settled by a real transaction", () => {
    const inputs = emptyInputs({
      scheduled_events: [{ id: "r", direction: "out", label: "Rent", category: "Rent", amount_minor: 100_000, start_date: addDays(today, -20), recurrence: "monthly", end_date: null, confidence: "scheduled", settled_dates: [addDays(today, -20)] }],
    });
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
    assert.equal(events.length, 1, "only next month's rent remains");
    assert.equal(events[0]!.date, "2026-11-08");
  });

  it("does not count revenue that has no collection event (cash sales are already in cash)", () => {
    const inputs = emptyInputs({ trailing_sales: { days: 28, cash_sales_minor: 900_000, credit_sales_minor: 0, stock_purchases_minor: 0, first_txn_date: "2026-08-01" } });
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
    assert.equal(events.length, 0, "no projections unless explicitly requested");
  });
});

describe("confidence and uncertainty", () => {
  it("excludes overdue customer debts by default instead of assuming immediate payment", () => {
    const inputs = demoInputs(today);
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
    const yaw = events.find((e) => e.label.startsWith("Yaw"))!;
    assert.equal(yaw.confidence, "uncertain");
    const f = computeForecast(300_000, events, { start: today, horizonDays: 30 });
    assert.ok(f.excluded.some((e) => e.ref === yaw.ref));
    const withUncertain = computeForecast(300_000, events, { start: today, horizonDays: 30, includeUncertain: true });
    assert.equal(withUncertain.closingCash - f.closingCash, 45_000);
  });

  it("assumes overdue bills are paid today (conservative)", () => {
    const inputs = emptyInputs({
      open_bills: [{ id: "b1", number: "BILL-1", supplier_id: "s", supplier_name: "Sup", kind: "expense", due_date: addDays(today, -3), outstanding_minor: 5_000 }],
    });
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 7 });
    assert.equal(events[0]!.date, today);
  });

  it("labels every event with a plain-language assumption", () => {
    const { events, assumptions } = buildBaselineEvents(demoInputs(today), { today, horizonDays: 30 });
    for (const e of events) assert.ok(e.assumption && e.assumption.length > 10, e.ref);
    assert.ok(assumptions.some((a) => a.includes("due date")));
  });

  it("projects sales only on request, as uncertain, and only with enough history", () => {
    const inputs = demoInputs(today);
    const withProj = buildBaselineEvents(inputs, { today, horizonDays: 7, includeProjectedSales: true });
    const sales = withProj.events.filter((e) => e.category === "projected_sales");
    assert.equal(sales.length, 6); // tomorrow..day 6
    assert.ok(sales.every((e) => e.confidence === "uncertain" && e.amount === 30_000));
    const noHistory = buildBaselineEvents({ ...inputs, trailing_sales: { ...inputs.trailing_sales, first_txn_date: addDays(today, -3) } }, { today, horizonDays: 7, includeProjectedSales: true });
    assert.equal(noHistory.events.filter((e) => e.category === "projected_sales").length, 0);
    assert.ok(noHistory.assumptions.some((a) => a.includes("at least 14 days")));
  });
});

describe("14. missing data produces warnings, not fabricated figures", () => {
  it("flags missing opening balance and missing obligations", () => {
    const inputs = emptyInputs({ business: { ...demoInputs(today).business, opening_balance_set: false } });
    const { gaps } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
    assert.deepEqual(gaps.map((g) => g.code).sort(), ["no_opening_balance", "no_upcoming_obligations"]);
    for (const g of gaps) assert.ok(g.message.length > 20);
  });
});

describe("shortfalls and reserve", () => {
  it("detects the first negative day and the worst point", () => {
    const events = [
      { ref: "a", date: addDays(today, 1), amount: -400, label: "x", category: "planned_expense" as const, confidence: "scheduled" as const },
      { ref: "b", date: addDays(today, 3), amount: -300, label: "y", category: "planned_expense" as const, confidence: "scheduled" as const },
      { ref: "c", date: addDays(today, 5), amount: 1_000, label: "z", category: "customer_collection" as const, confidence: "expected" as const },
    ];
    const f = computeForecast(500, events, { start: today, horizonDays: 7, reserve: 200 });
    assert.equal(f.firstBelowReserveDate, addDays(today, 1));
    assert.equal(f.firstShortfallDate, addDays(today, 3));
    assert.equal(f.worstShortfall, -200);
    assert.equal(f.closingCash, 800);
  });

  it("rejects invalid horizons and fractional amounts", () => {
    assert.throws(() => computeForecast(0, [], { start: today, horizonDays: 0 }));
    assert.throws(() => computeForecast(10.5, [], { start: today, horizonDays: 7 }));
  });
});

describe("recurrence expansion", () => {
  it("expands weekly and monthly events within a window", () => {
    assert.deepEqual(expandOccurrences({ start_date: "2026-10-01", recurrence: "weekly", end_date: null }, "2026-10-10", "2026-10-31"), ["2026-10-15", "2026-10-22", "2026-10-29"]);
    assert.deepEqual(expandOccurrences({ start_date: "2026-01-31", recurrence: "monthly", end_date: "2026-04-30" }, "2026-01-01", "2026-12-31"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    assert.deepEqual(expandOccurrences({ start_date: "2026-11-05", recurrence: "none", end_date: null }, "2026-10-28", "2026-11-30"), ["2026-11-05"]);
  });
});
