// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { AlertTriangle, Save, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Checkbox, Input } from "@/components/ui/field";
import { Notice, StatusBadge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { addDays, formatDate, relativeDay } from "@/core/dates";
import { formatMoney } from "@/core/money";
import { computeForecast, HORIZONS, totalsByConfidence } from "@/core/forecast/engine";
import { buildBaselineEvents, salesProjection } from "@/core/forecast/events";
import { applyScenario, compareScenario } from "@/core/forecast/scenario";
import type { ForecastInputs } from "@/core/forecast/types";
import { scenarioAdjustment, type ScenarioAdjustment } from "@/core/validation/scenario";
import { saveScenario } from "@/lib/actions/records";
import { AdjustmentEditor } from "./adjustment-editor";

export interface SavedScenarioLite {
  id: string;
  name: string;
  description: string | null;
  horizon_days: number;
  adjustments: unknown[];
}

/**
 * Cash-flow forecast + what-if simulator. All calculations run in the browser
 * with the same pure engine the server and AI assistant use. Nothing here can
 * change financial records; "Save scenario" stores only the assumptions.
 */
export function CashFlowWorkspace({ inputs, today, saved, initialScenarioId }: { inputs: ForecastInputs; today: string; saved: SavedScenarioLite[]; initialScenarioId?: string }) {
  const [horizon, setHorizon] = useState<number>(30);
  const [includeUncertain, setIncludeUncertain] = useState(false);
  const [includeProjection, setIncludeProjection] = useState(false);
  const initial = saved.find((s) => s.id === initialScenarioId);
  const [adjustments, setAdjustments] = useState<ScenarioAdjustment[]>(() => parseAdjustments(initial?.adjustments ?? []));
  const [scenarioName, setScenarioName] = useState(initial?.name ?? "");
  const [scenarioId, setScenarioId] = useState<string | undefined>(initial?.id);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const currency = inputs.business.currency;
  const reserve = inputs.business.min_cash_reserve_minor;
  const opening = Number(inputs.cash_balance_minor);

  const model = useMemo(() => {
    const baseline = buildBaselineEvents(inputs, { today, horizonDays: horizon, includeProjectedSales: includeProjection });
    const opts = { start: today, horizonDays: horizon, reserve, includeUncertain };
    const inventoryBills = new Set(inputs.open_bills.filter((b) => b.kind === "inventory").map((b) => `bill:${b.id}`));
    const applied = applyScenario(baseline.events, adjustments, { today, horizonDays: horizon, currency, projection: salesProjection(inputs, today), baselineHasProjection: includeProjection }, inventoryBills);
    const cmp = compareScenario(opening, baseline.events, applied.events, opts);
    return { baseline, applied, cmp, hasScenario: adjustments.length > 0, conf: totalsByConfidence(cmp.baseline) };
  }, [inputs, today, horizon, includeUncertain, includeProjection, adjustments, reserve, opening, currency]);

  const { cmp, baseline, applied, hasScenario } = model;
  const shown = hasScenario ? cmp.scenario : cmp.baseline;
  const chartData = cmp.series.map((p) => ({ date: p.date, baseline: p.baseline, scenario: hasScenario ? p.scenario : undefined }));
  const invoices = inputs.open_invoices.map((i) => ({ id: i.id, label: `${i.customer_name} ${formatMoney(i.outstanding_minor, { currency })}`, due_date: i.due_date }));

  function loadScenario(id: string) {
    const s = saved.find((x) => x.id === id);
    setScenarioId(s?.id);
    setScenarioName(s?.name ?? "");
    setAdjustments(parseAdjustments(s?.adjustments ?? []));
    if (s && HORIZONS.includes(s.horizon_days as (typeof HORIZONS)[number])) setHorizon(s.horizon_days);
    setSaveMsg(null);
  }

  function onSave() {
    startSaving(async () => {
      const res = await saveScenario({ id: scenarioId, name: scenarioName || "My scenario", description: "", horizon_days: horizon, adjustments });
      if (res.ok) {
        setScenarioId(res.data?.id ?? scenarioId);
        setSaveMsg({ ok: true, text: "Scenario saved. Your actual records were not changed." });
      } else setSaveMsg({ ok: false, text: res.error });
    });
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="radiogroup" aria-label="Forecast period" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={horizon === h}
              onClick={() => setHorizon(h)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", horizon === h ? "bg-brand-soft text-brand-strong" : "text-ink-soft hover:text-ink")}
            >
              {h} days
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox label="Include overdue customer debts (uncertain)" checked={includeUncertain} onChange={(e) => setIncludeUncertain(e.target.checked)} />
          <Checkbox label="Project sales from recent history" checked={includeProjection} onChange={(e) => setIncludeProjection(e.target.checked)} />
        </div>
      </div>

      {baseline.gaps.map((g) => (
        <Notice key={g.code} tone="warning" title="Forecast may be incomplete">
          {g.message}
        </Notice>
      ))}

      {/* Headline figures */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Cash today" value={opening} currency={currency} />
        <Figure label={`Estimated cash on ${formatDate(cmp.baseline.end, { year: false })}`} value={shown.closingCash} currency={currency} diff={hasScenario ? cmp.closingDifference : undefined} />
        <Figure label="Lowest point" value={shown.minBalance} currency={currency} sub={formatDate(shown.minBalanceDate, { weekday: true, year: false })} tone={shown.minBalance < 0 ? "danger" : reserve !== null && shown.minBalance < reserve ? "warning" : undefined} diff={hasScenario ? cmp.minBalanceDifference : undefined} />
        <div className={cn("rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]", shown.firstShortfallDate ? "border-red-200 bg-danger-soft" : "border-line bg-surface")}>
          <p className="text-[13px] font-medium text-ink-soft">Cash shortfall</p>
          {shown.firstShortfallDate ? (
            <>
              <p className="text-lg font-semibold text-danger">From {formatDate(shown.firstShortfallDate, { year: false })}</p>
              <p className="text-xs text-ink-soft">{relativeDay(shown.firstShortfallDate, today)} · short by {formatMoney(-shown.worstShortfall, { currency })}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-positive">None projected</p>
              <p className="text-xs text-ink-soft">Cash stays above zero</p>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title={hasScenario ? "Current forecast vs your scenario" : "Projected cash, day by day"}
          description="Estimates based on what you have recorded — not a guarantee."
          action={
            hasScenario ? (
              <div className="flex items-center gap-3 text-xs text-ink-soft">
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-4 bg-brand" /> Current
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-4 border-t-2 border-dashed border-ink" /> Scenario
                </span>
              </div>
            ) : undefined
          }
        />
        <CardBody>
          <ForecastChart data={chartData} reserve={reserve} scenarioLabel={scenarioName || "Scenario"} />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Scenario builder */}
        <Card className="lg:col-span-2">
          <CardHeader title="What-if simulator" description="Try a decision before you make it. Nothing is recorded." />
          <CardBody className="space-y-4">
            {saved.length > 0 && (
              <div className="space-y-1.5">
                <label htmlFor="saved-scenarios" className="text-sm font-medium">
                  Saved scenarios
                </label>
                <select id="saved-scenarios" className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" value={scenarioId ?? ""} onChange={(e) => loadScenario(e.target.value)}>
                  <option value="">— New scenario —</option>
                  {saved.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {adjustments.length > 0 && (
              <ul className="space-y-2">
                {adjustments.map((a, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                    <span>{describe(a, today, currency)}</span>
                    <button type="button" onClick={() => setAdjustments((xs) => xs.filter((_, j) => j !== i))} className="rounded p-1 text-ink-muted hover:bg-canvas hover:text-danger" aria-label="Remove change">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <AdjustmentEditor today={today} events={baseline.events} invoices={invoices} onAdd={(a) => setAdjustments((xs) => [...xs, a].slice(0, 20))} />

            {hasScenario && (
              <div className="space-y-2 border-t border-line pt-4">
                <label htmlFor="scenario-name" className="text-sm font-medium">
                  Save these assumptions
                </label>
                <div className="flex gap-2">
                  <Input id="scenario-name" placeholder="e.g. Restock before Christmas" value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} maxLength={120} />
                  <Button type="button" onClick={onSave} disabled={saving}>
                    <Save className="size-4" aria-hidden /> {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
                {saveMsg && <p className={cn("text-xs", saveMsg.ok ? "text-positive" : "text-danger")}>{saveMsg.text}</p>}
                <Button type="button" variant="ghost" size="sm" onClick={() => loadScenario("")}>
                  Clear scenario
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Comparison + assumptions */}
        <Card className="lg:col-span-3">
          <CardHeader title={hasScenario ? "What changes" : "Assumptions"} />
          <CardBody className="space-y-4 text-sm">
            {hasScenario && (
              <>
                {cmp.createsShortfall && (
                  <Notice tone="danger" title="This decision could leave you short of cash">
                    Cash would drop below zero from {formatDate(cmp.scenario.firstShortfallDate!)} and reach {formatMoney(cmp.scenario.minBalance, { currency })} at the lowest.
                  </Notice>
                )}
                {cmp.resolvesShortfall && <Notice tone="success" title="This avoids the shortfall in your current forecast" />}
                {!cmp.createsShortfall && !cmp.resolvesShortfall && cmp.scenario.firstShortfallDate === null && (
                  <Notice tone="success" title="Cash stays above zero in this scenario">
                    Lowest point {formatMoney(cmp.scenario.minBalance, { currency })} on {formatDate(cmp.scenario.minBalanceDate)}
                    {reserve !== null && cmp.scenario.minBalance < reserve ? ` — below your ${formatMoney(reserve, { currency })} safety buffer.` : "."}
                  </Notice>
                )}
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Compare label="Closing cash" a={cmp.baseline.closingCash} b={cmp.scenario.closingCash} currency={currency} />
                  <Compare label="Lowest point" a={cmp.baseline.minBalance} b={cmp.scenario.minBalance} currency={currency} />
                  <div className="rounded-lg bg-canvas p-2">
                    <dt className="text-xs text-ink-muted">Shortfall from</dt>
                    <dd className="text-xs">Now: {cmp.baseline.firstShortfallDate ? formatDate(cmp.baseline.firstShortfallDate, { year: false }) : "none"}</dd>
                    <dd className="text-xs font-semibold">Scenario: {cmp.scenario.firstShortfallDate ? formatDate(cmp.scenario.firstShortfallDate, { year: false }) : "none"}</dd>
                  </div>
                </dl>
                <div>
                  <h3 className="mb-1 font-semibold">Scenario assumptions</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-ink-soft">
                    {applied.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                  {applied.warnings.map((w, i) => (
                    <p key={i} className="mt-1 flex gap-1.5 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
                    </p>
                  ))}
                </div>
              </>
            )}
            <div>
              <h3 className="mb-1 font-semibold">{hasScenario ? "Baseline assumptions" : "How this forecast is built"}</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-ink-soft">
                {baseline.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Event list */}
      <Card>
        <CardHeader title="Money expected in and out" description={`Next ${horizon} days · ${hasScenario ? "including your scenario" : "current forecast"}`} />
        {(hasScenario ? applied.events : baseline.events).filter((e) => e.date <= addDays(today, horizon - 1)).length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-muted">Nothing scheduled. Add customer credit sales, supplier bills or planned payments to build your forecast.</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {(hasScenario ? applied.events : baseline.events)
              .filter((e) => e.date <= addDays(today, horizon - 1) && (e.category !== "projected_sales" && e.category !== "projected_purchases"))
              .map((e) => {
                const excluded = shown.excluded.some((x) => x.ref === e.ref);
                return (
                  <li key={e.ref} className={cn("flex items-start justify-between gap-3 px-5 py-3", excluded && "opacity-60")}>
                    <div className="min-w-0">
                      <p className="font-medium">
                        {e.label} {e.category === "scenario" && <span className="text-xs text-info">(what-if)</span>}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {formatDate(e.date, { weekday: true, year: false })} · {e.assumption ?? ""}
                        {excluded && " · not counted"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={e.confidence} />
                      <Money value={e.amount} signed tone={e.amount > 0 ? "positive" : "none"} currency={currency} className="font-medium" />
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
        {model.conf && (
          <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">
            Counted: scheduled out {formatMoney(model.conf.scheduled.outflow, { currency })} · expected in {formatMoney(model.conf.expected.inflow, { currency })}
            {includeUncertain && ` · uncertain in ${formatMoney(model.conf.uncertain.inflow, { currency })}`}
          </p>
        )}
      </Card>
    </div>
  );
}

function parseAdjustments(raw: unknown[]): ScenarioAdjustment[] {
  return raw.map((a) => scenarioAdjustment.safeParse(a)).filter((r) => r.success).map((r) => r.data!);
}

function describe(a: ScenarioAdjustment, today: string, currency: string): string {
  const m = (v: number) => formatMoney(v, { currency });
  const when = (x: { date?: string; day_offset?: number }) => formatDate(x.date ?? addDays(today, x.day_offset ?? 0), { year: false });
  switch (a.kind) {
    case "one_off":
      return `${a.direction === "out" ? "Spend" : "Receive"} ${m(a.amount_minor)} on ${when(a)} — ${a.label}`;
    case "recurring":
      return `${a.label}: ${m(a.amount_minor)} ${a.interval === "weekly" ? "weekly" : "monthly"} from ${formatDate(a.start_date ?? addDays(today, a.start_offset ?? 0), { year: false })}`;
    case "collect_early":
      return `Customer pays on ${when(a)}`;
    case "delay_event":
      return `Move a payment ${a.days} day${a.days === 1 ? "" : "s"} later`;
    case "exclude_event":
      return "An expected item doesn't happen";
    case "sales_change_pct":
      return `Sales ${a.pct >= 0 ? "+" : ""}${a.pct}%`;
    case "supplier_price_change_pct":
      return `Supplier prices ${a.pct >= 0 ? "+" : ""}${a.pct}%`;
  }
}

function Figure({ label, value, currency, sub, tone, diff }: { label: string; value: number; currency: string; sub?: string; tone?: "danger" | "warning"; diff?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      <p className={cn("tabular text-xl font-semibold", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "")}>{formatMoney(value, { currency })}</p>
      {sub && <p className="text-xs text-ink-muted">{sub}</p>}
      {diff !== undefined && diff !== 0 && <p className={cn("text-xs font-medium", diff < 0 ? "text-danger" : "text-positive")}>{formatMoney(diff, { currency, signed: true })} vs now</p>}
    </div>
  );
}

function Compare({ label, a, b, currency }: { label: string; a: number; b: number; currency: string }) {
  return (
    <div className="rounded-lg bg-canvas p-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="tabular text-xs">Now: {formatMoney(a, { currency })}</dd>
      <dd className={cn("tabular text-xs font-semibold", b < 0 && "text-danger")}>Scenario: {formatMoney(b, { currency })}</dd>
    </div>
  );
}
