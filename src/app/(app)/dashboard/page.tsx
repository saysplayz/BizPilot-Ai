// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, Receipt, Sparkles, Wallet, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { PeriodPicker } from "@/components/period-picker";
import { cashDirection, TXN_LABEL } from "@/components/txn-labels";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState, Notice, StatusBadge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { presentCashPosition, presentForecast } from "@/core/ai/presenters";
import { diffDays, formatDate, relativeDay } from "@/core/dates";
import { formatMoney } from "@/core/money";
import { dismissAlert } from "@/lib/actions/records";
import { requireBusiness } from "@/lib/context";
import {
  getForecast,
  getMoneyAccounts,
  getPayables,
  getPosition,
  getProductVelocity,
  getProfitSummary,
  getReceivables,
  lowStock,
  refreshAlerts,
} from "@/lib/data/finance";
import { listTransactions } from "@/lib/data/records";
import { resolvePeriod } from "@/lib/periods";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string; welcome?: string; demo?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const currency = ctx.business.currency;
  const period = resolvePeriod(sp.period ?? "this_month", ctx.today);

  const [position, accounts, salesToday, profit, receivables, payables, velocity, forecast, recent] = await Promise.all([
    getPosition(ctx),
    getMoneyAccounts(ctx),
    getProfitSummary(ctx, resolvePeriod("today", ctx.today)),
    getProfitSummary(ctx, period),
    getReceivables(ctx),
    getPayables(ctx),
    getProductVelocity(ctx, 30),
    getForecast(ctx, 30),
    listTransactions(ctx, { page: 1 }),
  ]);
  const alerts = await refreshAlerts(ctx, forecast.result);

  const overdue = receivables.filter((r) => r.days_overdue > 0).reduce((s, r) => s + r.outstanding_minor, 0);
  const low = lowStock(velocity);
  const f = forecast.result;
  const upcoming = f.included.filter((e) => e.amount < 0 && diffDays(ctx.today, e.date) <= 14).slice(0, 5);
  const isEmpty = position.gaps.some((g) => g.code === "no_transactions");
  const summary = [presentCashPosition(position, accounts, currency).summary, presentForecast(f, forecast.baseline.assumptions, forecast.baseline.gaps, ctx.today, currency).summary];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${ctx.business.name} · ${formatDate(ctx.today, { weekday: true })}`}
        actions={<PeriodPicker active={period.preset} basePath="/dashboard" />}
      />

      {sp.welcome && (
        <Notice tone="success" title="Your business is set up." className="mb-4">
          Record your first sale or expense with the <strong>Record</strong> button. Add rent, wages and supplier bills so your cash forecast is accurate.
        </Notice>
      )}

      {position.gaps.filter((g) => g.code !== "no_transactions").map((g) => (
        <Notice key={g.code} tone="warning" className="mb-3" action={g.code === "no_opening_balance" ? <LinkButton href="/settings#opening" size="sm" variant="secondary">Add it</LinkButton> : undefined}>
          {g.message}
        </Notice>
      ))}

      {isEmpty ? (
        <Card className="mb-5">
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="Let's record your first sale"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LinkButton href="/transactions/new?type=sale">Record a sale</LinkButton>
                <LinkButton href="/transactions/new?type=expense" variant="secondary">
                  Record an expense
                </LinkButton>
                <LinkButton href="/inventory/new" variant="secondary">
                  Add a product
                </LinkButton>
              </div>
            }
          >
            Tap <strong>Record</strong> whenever money comes in or goes out. Choose &quot;paid now&quot; or &quot;customer will pay later&quot; — BizPilot keeps sales, cash and debts apart for you. Your numbers will appear here.
          </EmptyState>
        </Card>
      ) : null}

      {alerts.length > 0 && (
        <section aria-label="Alerts" className="mb-5 space-y-2">
          {alerts.slice(0, 4).map((a) => (
            <Notice
              key={a.id}
              tone={a.severity === "critical" ? "danger" : a.severity === "warning" ? "warning" : "info"}
              title={a.title}
              action={
                a.id.startsWith("local-") ? undefined : (
                  <form action={dismissAlert}>
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="rounded p-1 text-ink-muted hover:bg-white/60" aria-label={`Dismiss: ${a.title}`}>
                      <X className="size-4" />
                    </button>
                  </form>
                )
              }
            >
              {a.message}
            </Notice>
          ))}
        </section>
      )}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard plainLabel="Cash you have now" term="Cash position" value={position.cash} currency={currency} icon={<Wallet className="size-4" />} href="/reports#cash" hint={accounts.length > 1 ? accounts.map((a) => `${a.name}: ${formatMoney(a.balance_minor, { currency })}`).join(" · ") : undefined} tone={position.cash < 0 ? "danger" : "neutral"} />
        <StatCard plainLabel="Sales today" term="Revenue" value={salesToday.netSales} currency={currency} href="/transactions?type=sales" />
        <StatCard plainLabel={`Sales ${period.label}`} term="Revenue (not all is cash)" value={profit.netSales} currency={currency} href={`/reports?period=${period.preset}`} />
        <StatCard
          plainLabel={`Profit ${period.label} after costs`}
          term="Net operating profit"
          value={profit.netOperatingProfit}
          currency={currency}
          estimate={profit.isEstimate}
          tone={profit.netOperatingProfit < 0 ? "danger" : "positive"}
          hint={profit.isEstimate ? "Some sales have no recorded cost" : `After ${formatMoney(profit.operatingExpenses, { currency })} of expenses`}
          href={`/reports?period=${period.preset}`}
        />
        <StatCard plainLabel="Customers owe you" term="Receivables" value={position.receivables} currency={currency} href="/customers" tone={overdue > 0 ? "warning" : "neutral"} hint={overdue > 0 ? `Overdue: ${formatMoney(overdue, { currency })}` : undefined} />
        <StatCard plainLabel="You owe suppliers" term="Payables" value={position.payables} currency={currency} href="/suppliers" />
        <StatCard
          plainLabel="Cash in 30 days (estimate)"
          term="Forecast"
          value={f.closingCash}
          currency={currency}
          href="/cash-flow"
          tone={f.firstShortfallDate ? "danger" : f.firstBelowReserveDate ? "warning" : "neutral"}
          hint={f.firstShortfallDate ? `Could run short ${relativeDay(f.firstShortfallDate, ctx.today)}` : `Lowest point ${formatMoney(f.minBalance, { currency })}`}
        />
        <StatCard plainLabel="Gross profit" term={`Sales − cost of goods, ${period.label}`} value={profit.grossProfit} currency={currency} estimate={profit.isEstimate} href={`/reports?period=${period.preset}`} />
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Cash forecast · next 30 days"
            description="Estimate from recorded bills, planned payments and expected customer payments."
            action={
              <Link href="/cash-flow" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                Details <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          <CardBody>
            <ForecastChart data={f.days.map((d) => ({ date: d.date, baseline: d.closing }))} reserve={f.reserve} height={220} />
            {forecast.baseline.gaps.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Incomplete: {forecast.baseline.gaps.map((g) => g.message).join(" ")}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Coming up" description="Next 14 days" action={<CalendarClock className="size-4 text-ink-muted" aria-hidden />} />
          <CardBody className="p-0">
            {upcoming.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-muted">
                No bills or planned payments recorded.{" "}
                <Link href="/cash-flow#planned" className="font-medium text-brand hover:underline">
                  Add rent or wages
                </Link>
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((e) => (
                  <li key={e.ref} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.label}</p>
                      <p className="text-xs text-ink-muted">{e.date === ctx.today ? "Due now" : formatDate(e.date, { weekday: true, year: false })}</p>
                    </div>
                    <Money value={-e.amount} currency={currency} className="font-medium" />
                  </li>
                ))}
              </ul>
            )}
            {payables.length > 0 && (
              <p className="border-t border-line px-5 py-2.5 text-xs text-ink-muted">
                {payables.length} unpaid supplier bill{payables.length === 1 ? "" : "s"}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent activity"
            action={
              <Link href="/transactions" className="text-sm font-medium text-brand hover:underline">
                View all
              </Link>
            }
          />
          <CardBody className="p-0">
            {recent.rows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {recent.rows.slice(0, 6).map((t) => {
                  const dir = cashDirection(t.type);
                  return (
                    <li key={t.id}>
                      <Link href={`/transactions/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-canvas/60">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.description}</p>
                          <p className="text-xs text-ink-muted">
                            {TXN_LABEL[t.type]} · {formatDate(t.txn_date, { year: false })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {t.status === "voided" && <StatusBadge status="voided" />}
                          <Money value={dir === "out" ? -t.amount_minor : t.amount_minor} signed={dir !== "none"} tone={t.status === "voided" ? "none" : dir === "in" ? "positive" : "none"} currency={currency} className={t.status === "voided" ? "line-through text-ink-muted" : "font-medium"} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Low stock" action={<Boxes className="size-4 text-ink-muted" aria-hidden />} />
            <CardBody className="p-0">
              {low.length === 0 ? (
                <p className="px-5 py-5 text-sm text-ink-muted">Nothing is running low.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {low.slice(0, 5).map((p) => (
                    <li key={p.product_id}>
                      <Link href={`/inventory/${p.product_id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-canvas/60">
                        <span className="truncate">{p.name}</span>
                        <span className={p.quantity_on_hand === 0 ? "font-semibold text-danger" : "font-medium text-warning"}>{p.quantity_on_hand} left</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Summary" description="Calculated from your records" action={<Sparkles className="size-4 text-brand" aria-hidden />} />
            <CardBody className="space-y-2 text-sm text-ink-soft">
              {isEmpty ? <p>Record a few sales and expenses to see a summary here.</p> : summary.map((s, i) => <p key={i}>{s}</p>)}
              <LinkButton href="/assistant" variant="secondary" size="sm" className="mt-1">
                Ask the assistant
              </LinkButton>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
