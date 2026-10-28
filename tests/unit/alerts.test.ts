// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays } from "../../src/core/dates";
import { deriveAlerts, type AlertInputs } from "../../src/core/forecast/alerts";
import { computeForecast } from "../../src/core/forecast/engine";
import { buildBaselineEvents } from "../../src/core/forecast/events";
import { applyScenario } from "../../src/core/forecast/scenario";
import { salesProjection } from "../../src/core/forecast/events";
import { demoInputs } from "../fixtures/demo";

const today = "2026-10-28";
const inputs = demoInputs(today);

function alertInputs(over: Partial<AlertInputs> = {}): AlertInputs {
  const { events } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
  return {
    today,
    forecast: computeForecast(300_000, events, { start: today, horizonDays: 30, reserve: 50_000 }),
    receivables: inputs.open_invoices.map((i) => ({ invoice_id: i.id, customer_name: i.customer_name, due_date: i.due_date, outstanding_minor: i.outstanding_minor })),
    payables: inputs.open_bills.map((b) => ({ bill_id: b.id, supplier_name: b.supplier_name, due_date: b.due_date, outstanding_minor: b.outstanding_minor })),
    expenses: { current: 50_000, previous: 45_000 },
    lowStock: [{ product_id: "p5", name: "Power Bank", quantity_on_hand: 2 }],
    ...over,
  };
}

describe("alerts", () => {
  it("raises the expected demo alerts", () => {
    const kinds = deriveAlerts(alertInputs()).map((a) => a.kind).sort();
    // Cash covers rent and the bill before Ama pays (it bottoms out exactly at the reserve), so no timing alert.
    assert.deepEqual(kinds, ["collections_missed", "low_stock", "overdue_receivables", "upcoming_obligations"]);
  });

  it("warns when bills fall due before collections and cash would dip under the buffer", () => {
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
    const forecast = computeForecast(300_000, events, { start: today, horizonDays: 30, reserve: 100_000 });
    const alerts = deriveAlerts(alertInputs({ forecast }));
    const timing = alerts.find((a) => a.kind === "bills_before_collections")!;
    assert.ok(timing, "timing alert raised");
    assert.match(timing.message, /GH₵2,500\.00 in bills and planned payments falls due before Ama Mensah/);
    assert.ok(alerts.some((a) => a.kind === "below_reserve"));
  });

  it("raises a critical shortfall alert when a scenario-like forecast goes negative", () => {
    const { events } = buildBaselineEvents(inputs, { today, horizonDays: 30 });
    const applied = applyScenario(events, [{ kind: "one_off", direction: "out", amount_minor: 200_000, label: "Stock", day_offset: 1 }], {
      today,
      horizonDays: 30,
      projection: salesProjection(inputs, today),
      baselineHasProjection: false,
    });
    const forecast = computeForecast(300_000, applied.events, { start: today, horizonDays: 30, reserve: 50_000 });
    const alerts = deriveAlerts(alertInputs({ forecast }));
    const shortfall = alerts.find((a) => a.kind === "cash_shortfall")!;
    assert.equal(shortfall.severity, "critical");
    assert.ok(shortfall.message.includes("estimate"));
    assert.equal(alerts.some((a) => a.kind === "below_reserve"), false, "shortfall supersedes reserve warning");
  });

  it("produces stable fingerprints for unchanged situations and new ones for material changes", () => {
    const a = deriveAlerts(alertInputs());
    const b = deriveAlerts(alertInputs());
    assert.deepEqual(a.map((x) => x.fingerprint), b.map((x) => x.fingerprint));
    const changed = deriveAlerts(alertInputs({ receivables: [...alertInputs().receivables, { invoice_id: "new", customer_name: "Esi", due_date: addDays(today, -2), outstanding_minor: 10_000 }] }));
    const fp = (xs: typeof a) => xs.find((x) => x.kind === "overdue_receivables")!.fingerprint;
    assert.notEqual(fp(a), fp(changed));
  });

  it("flags unusual spending only when material", () => {
    assert.ok(deriveAlerts(alertInputs({ expenses: { current: 150_000, previous: 60_000 } })).some((a) => a.kind === "high_expenses"));
    assert.equal(deriveAlerts(alertInputs({ expenses: { current: 55_000, previous: 50_000 } })).some((a) => a.kind === "high_expenses"), false);
  });
});
