// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { Metadata } from "next";
import { CashFlowWorkspace } from "@/components/cashflow/workspace";
import { ScheduledEventForm } from "@/components/forms/scheduled-event-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { formatDate } from "@/core/dates";
import { deleteScenario, stopScheduledEvent } from "@/lib/actions/records";
import { requireBusiness } from "@/lib/context";
import { getForecastInputs } from "@/lib/data/finance";
import { listScenarios, listScheduledEvents, scenarioAdjustments } from "@/lib/data/records";

export const metadata: Metadata = { title: "Cash Flow" };

const RECURRENCE: Record<string, string> = { none: "once", weekly: "weekly", monthly: "monthly" };

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const { scenario } = await searchParams;
  const ctx = await requireBusiness();
  const [inputs, planned, scenarios] = await Promise.all([getForecastInputs(ctx), listScheduledEvents(ctx), listScenarios(ctx)]);
  const currency = ctx.business.currency;

  return (
    <>
      <PageHeader title="Cash Flow" description="See your cash day by day, and test decisions before you make them. Every figure here is an estimate." />
      <CashFlowWorkspace
        inputs={inputs}
        today={ctx.today}
        initialScenarioId={scenario}
        saved={scenarios.map((s) => ({ id: s.id, name: s.name, description: s.description, horizon_days: s.horizon_days, adjustments: scenarioAdjustments(s) }))}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card id="planned">
          <CardHeader title="Planned payments & income" description="Rent, wages, loan repayments — anything not yet billed. Linking a recorded expense to one stops it being counted twice." />
          <CardBody className="space-y-4">
            {planned.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {planned.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium">{e.label}</p>
                      <p className="text-xs text-ink-muted">
                        {e.direction === "out" ? "Pay" : "Receive"} {RECURRENCE[e.recurrence]} from {formatDate(e.start_date)}
                        {e.end_date ? ` until ${formatDate(e.end_date)}` : ""} · {e.confidence}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Money value={e.direction === "out" ? -Number(e.amount_minor) : Number(e.amount_minor)} signed currency={currency} />
                      <form action={stopScheduledEvent}>
                        <input type="hidden" name="id" value={e.id} />
                        <Button size="sm" variant="ghost" type="submit" aria-label={`Stop ${e.label}`}>
                          Stop
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ScheduledEventForm today={ctx.today} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Saved scenarios" description="Assumptions only — saving or deleting never changes your records." />
          <CardBody>
            {scenarios.length === 0 ? (
              <p className="text-sm text-ink-muted">Build a what-if above and save it to compare later.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {scenarios.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <a href={`/cash-flow?scenario=${s.id}`} className="font-medium hover:text-brand hover:underline">
                        {s.name}
                      </a>
                      {s.description && <p className="text-xs text-ink-muted">{s.description}</p>}
                    </div>
                    <form action={deleteScenario}>
                      <input type="hidden" name="id" value={s.id} />
                      <Button size="sm" variant="ghost" type="submit">
                        Delete
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
