// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays } from "../../src/core/dates";
import { buildBaselineEvents, salesProjection } from "../../src/core/forecast/events";
import { applyScenario, compareScenario } from "../../src/core/forecast/scenario";
import { scenarioAdjustment, scenarioSchema, type ScenarioAdjustment } from "../../src/core/validation/scenario";
import { demoInputs } from "../fixtures/demo";

const today = "2026-10-28";
const inputs = demoInputs(today);
const AMA_INVOICE = inputs.open_invoices[0]!.id;
const BILL = inputs.open_bills[0]!.id;

function setup(horizonDays = 30) {
  const baseline = buildBaselineEvents(inputs, { today, horizonDays });
  const ctx = { today, horizonDays, projection: salesProjection(inputs, today), baselineHasProjection: false };
  const opts = { start: today, horizonDays, reserve: 50_000 };
  return { baseline, ctx, opts };
}

function run(adjustments: ScenarioAdjustment[], horizonDays = 30) {
  const { baseline, ctx, opts } = setup(horizonDays);
  const applied = applyScenario(baseline.events, adjustments, ctx, new Set([`bill:${BILL}`]));
  return { applied, cmp: compareScenario(300_000, baseline.events, applied.events, opts), baseline };
}

const buyStock = (day_offset: number): ScenarioAdjustment => ({
  kind: "one_off",
  direction: "out",
  amount_minor: 200_000,
  label: "Proposed stock purchase",
  category: "Stock purchases",
  day_offset,
});

describe("what-if scenarios (demo story)", () => {
  it("buying GH₵2,000 of stock tomorrow creates a timing shortfall until Ama pays", () => {
    const { cmp } = run([buyStock(1)]);
    assert.equal(cmp.baseline.firstShortfallDate, null);
    assert.equal(cmp.scenario.firstShortfallDate, addDays(today, 5));
    assert.equal(cmp.scenario.minBalance, -150_000);
    assert.equal(cmp.scenario.days[10]!.closing, 50_000); // recovers when Ama pays
    assert.equal(cmp.createsShortfall, true);
    assert.equal(cmp.closingDifference, -200_000);
    assert.equal(cmp.series.length, 30);
  });

  it("collecting from Ama early (day 4) avoids the shortfall", () => {
    const { cmp, applied } = run([buyStock(1), { kind: "collect_early", invoice_id: AMA_INVOICE, day_offset: 4 }]);
    assert.equal(cmp.scenario.firstShortfallDate, null);
    assert.equal(cmp.scenario.minBalance, 0);
    assert.ok(applied.assumptions.some((a) => a.includes("Ama Mensah")));
  });

  it("waiting until Ama pays (day 10) keeps cash above zero", () => {
    const { cmp } = run([buyStock(10)]);
    assert.equal(cmp.scenario.firstShortfallDate, null);
    assert.equal(cmp.scenario.minBalance, 50_000);
  });
});

describe("each adjustment type", () => {
  it("delays an event", () => {
    const { applied } = run([{ kind: "delay_event", event_ref: `bill:${BILL}`, days: 7 }]);
    assert.equal(applied.events.find((e) => e.ref === `bill:${BILL}`)!.date, addDays(today, 12));
  });

  it("delays every occurrence matched by a planned-payment prefix", () => {
    const rentRef = `scheduled:${inputs.scheduled_events[0]!.id}`;
    const { applied } = run([{ kind: "delay_event", event_ref: rentRef, days: 7 }], 60);
    const rent = applied.events.filter((e) => e.ref.startsWith(rentRef)).map((e) => e.date);
    assert.deepEqual(rent, [addDays(today, 10), "2026-12-07"]);
  });

  it("models hiring an employee as a recurring monthly cost", () => {
    const { cmp, applied } = run([{ kind: "recurring", direction: "out", amount_minor: 80_000, label: "Assistant wage", interval: "monthly", start_offset: 7 }], 60);
    const wages = applied.events.filter((e) => e.label === "Assistant wage");
    assert.equal(wages.length, 2);
    assert.equal(cmp.closingDifference, -160_000);
  });

  it("applies a sales decline to projected sales (adding a projection when needed)", () => {
    const { applied, baseline } = run([{ kind: "sales_change_pct", pct: -20 }], 7);
    assert.equal(baseline.events.some((e) => e.category === "projected_sales"), false);
    const sales = applied.events.filter((e) => e.category === "projected_sales");
    assert.equal(sales.length, 6);
    assert.ok(sales.every((e) => e.amount === 24_000)); // 30,000 a day −20%
    assert.ok(applied.assumptions.some((a) => a.includes("20% lower")));
  });

  it("raises future stock purchase costs but not bills already received", () => {
    const { applied } = run([buyStock(1), { kind: "supplier_price_change_pct", pct: 10 }]);
    assert.equal(applied.events.find((e) => e.label === "Proposed stock purchase")!.amount, -220_000);
    assert.equal(applied.events.find((e) => e.ref === `bill:${BILL}`)!.amount, -150_000);
  });

  it("warns when a price change has nothing to affect", () => {
    const { applied } = run([{ kind: "supplier_price_change_pct", pct: 10 }]);
    assert.equal(applied.warnings.length, 1);
  });

  it("removes an event (e.g. 'what if Ama never pays')", () => {
    const { cmp } = run([{ kind: "exclude_event", event_ref: `invoice:${AMA_INVOICE}` }]);
    assert.equal(cmp.scenario.closingCash, 50_000);
  });

  it("warns instead of failing when a referenced item has gone", () => {
    const { applied } = run([{ kind: "collect_early", invoice_id: "99999999-9999-4999-8999-999999999999", day_offset: 2 }]);
    assert.equal(applied.warnings.length, 1);
  });
});

describe("11. scenarios never change actual records", () => {
  it("leaves the baseline events untouched", () => {
    const { baseline, ctx } = setup();
    const snapshot = JSON.stringify(baseline.events);
    applyScenario(baseline.events, [buyStock(1), { kind: "delay_event", event_ref: `bill:${BILL}`, days: 3 }, { kind: "exclude_event", event_ref: `invoice:${AMA_INVOICE}` }], ctx);
    assert.equal(JSON.stringify(baseline.events), snapshot);
  });

  it("is a pure function of its inputs (same input, same output)", () => {
    const a = run([buyStock(1)]).cmp.scenario.days.map((d) => d.closing);
    const b = run([buyStock(1)]).cmp.scenario.days.map((d) => d.closing);
    assert.deepEqual(a, b);
  });
});

describe("scenario validation", () => {
  it("accepts well-formed adjustments and rejects malformed ones", () => {
    assert.equal(scenarioAdjustment.safeParse(buyStock(1)).success, true);
    assert.equal(scenarioAdjustment.safeParse({ ...buyStock(1), amount_minor: -5 }).success, false);
    assert.equal(scenarioAdjustment.safeParse({ ...buyStock(1), amount_minor: 10.5 }).success, false);
    assert.equal(scenarioAdjustment.safeParse({ kind: "one_off", direction: "out", amount_minor: 100, label: "x" }).success, false, "needs a date");
    assert.equal(scenarioAdjustment.safeParse({ kind: "one_off", direction: "out", amount_minor: 100, label: "x", date: "2026-13-01" }).success, false);
    assert.equal(scenarioAdjustment.safeParse({ kind: "sales_change_pct", pct: -150 }).success, false);
    assert.equal(scenarioAdjustment.safeParse({ kind: "unknown" }).success, false);
    assert.equal(scenarioSchema.safeParse({ name: "x", adjustments: Array(21).fill(buyStock(1)) }).success, false);
  });
});
