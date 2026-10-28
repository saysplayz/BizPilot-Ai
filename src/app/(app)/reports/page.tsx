// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { Upload } from "lucide-react";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/print-button";
import type { Metadata } from "next";
import { TrendChart } from "@/components/charts/trend-chart";
import { PeriodPicker } from "@/components/period-picker";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/core/dates";
import { monthlyTrends, summariseCashFlow } from "@/core/finance/metrics";
import { requireBusiness } from "@/lib/context";
import { getCashDaily, getMoneyAccounts, getMonthlyActivity, getPayables, getPosition, getProfitSummary, getReceivables } from "@/lib/data/finance";
import { listProducts } from "@/lib/data/records";
import { resolvePeriod } from "@/lib/periods";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const currency = ctx.business.currency;
  const period = resolvePeriod(sp.from && sp.to ? "custom" : (sp.period ?? "this_month"), ctx.today, { from: sp.from, to: sp.to });

  const [profit, cashDays, monthly, receivables, payables, position, accounts, products] = await Promise.all([
    getProfitSummary(ctx, period),
    getCashDaily(ctx, period),
    getMonthlyActivity(ctx, 6),
    getReceivables(ctx),
    getPayables(ctx),
    getPosition(ctx),
    getMoneyAccounts(ctx),
    listProducts(ctx),
  ]);
  const cash = summariseCashFlow(cashDays);
  const trends = monthlyTrends(monthly);
  const stockValue = products.reduce((s, p) => s + p.inventory_value_minor, 0);
  const M = ({ v, bold }: { v: number; bold?: boolean }) => <Money value={v} currency={currency} className={bold ? "font-semibold" : undefined} />;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${ctx.business.name} · ${formatDate(period.from)} – ${formatDate(period.to)}`}
        actions={
          <>
            <LinkButton href="/reports/import" variant="secondary" className="no-print">
              <Upload className="size-4" aria-hidden /> Import CSV
            </LinkButton>
            <PrintButton />
          </>
        }
      />
      <div className="no-print mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PeriodPicker active={period.preset} basePath="/reports" />
        <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="r-from" className="text-ink-soft">
            From
          </label>
          <Input id="r-from" type="date" name="from" defaultValue={period.preset === "custom" ? period.from : ""} className="h-9 w-40" />
          <label htmlFor="r-to" className="text-ink-soft">
            to
          </label>
          <Input id="r-to" type="date" name="to" defaultValue={period.preset === "custom" ? period.to : ""} className="h-9 w-40" />
          <button className="h-9 rounded-lg border border-line-strong bg-surface px-3 font-medium">Apply</button>
        </form>
      </div>

      {[...profit.gaps, ...position.gaps.filter((g) => g.code !== "no_transactions")].map((g) => (
        <Notice key={g.code} tone="warning" className="mb-3">
          {g.message}
        </Notice>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profit estimate" description="Sales minus the cost of goods sold and operating expenses" />
          <CardBody className="p-0">
            <dl className="divide-y divide-line text-sm">
              <Row label="Sales" value={<M v={profit.grossSales} />} />
              {profit.returns !== 0 && <Row label="Less refunds" value={<M v={-profit.returns} />} />}
              <Row label="Net sales" value={<M v={profit.netSales} bold />} />
              <Row label="Cost of goods sold" sub="Weighted-average cost of items sold" value={<M v={-profit.cogs} />} />
              <Row label={`Gross profit${profit.grossMarginPct !== null ? ` (${profit.grossMarginPct}% margin)` : ""}`} value={<M v={profit.grossProfit} bold />} />
              <Row label="Operating expenses" value={<M v={-profit.operatingExpenses} />} />
              {profit.stockLosses !== 0 && <Row label="Stock losses / gains" value={<M v={-profit.stockLosses} />} />}
              <Row label={`Net operating profit${profit.isEstimate ? " (estimate)" : ""}`} value={<M v={profit.netOperatingProfit} bold />} highlight />
              {profit.interest !== 0 && <Row label="Loan interest" value={<M v={-profit.interest} />} />}
              {profit.interest !== 0 && <Row label="Profit after interest" value={<M v={profit.netProfitAfterInterest} bold />} />}
            </dl>
            <p className="px-5 py-3 text-xs text-ink-muted">Loans, owner contributions/withdrawals and transfers are not income or expenses and are excluded. This is a management estimate, not a statutory or tax account.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Expenses by category" />
          <CardBody className="p-0">
            {profit.expensesByCategory.length === 0 ? (
              <p className="px-5 py-5 text-sm text-ink-muted">No expenses in this period.</p>
            ) : (
              <dl className="divide-y divide-line text-sm">
                {profit.expensesByCategory.map((e) => (
                  <Row key={e.category} label={e.category} value={<M v={e.amount} />} bar={profit.operatingExpenses > 0 ? e.amount / profit.operatingExpenses : 0} />
                ))}
                <Row label="Total" value={<M v={profit.operatingExpenses} bold />} />
              </dl>
            )}
          </CardBody>
        </Card>

        <Card id="cash">
          <CardHeader title="Cash movement" description="Money actually received and paid (transfers between your accounts excluded)" />
          <CardBody className="p-0">
            <dl className="divide-y divide-line text-sm">
              <Row label="Money in" value={<Money value={cash.inflow} currency={currency} tone="positive" />} />
              <Row label="Money out" value={<M v={-cash.outflow} />} />
              <Row label="Net cash movement" value={<Money value={cash.net} currency={currency} tone="auto" signed className="font-semibold" />} highlight />
              {accounts.map((a) => (
                <Row key={a.financial_account_id} label={`${a.name} balance today`} value={<M v={a.balance_minor} />} />
              ))}
              <Row label="Total cash today" value={<M v={position.cash} bold />} />
            </dl>
            <p className="px-5 py-3 text-xs text-ink-muted">Sales on credit increase sales but not cash until the customer pays — that is why profit and cash differ.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Balances today" />
          <CardBody className="p-0">
            <dl className="divide-y divide-line text-sm">
              <Row label="Customers owe you (receivables)" value={<M v={position.receivables} />} sub={`${receivables.length} open sale(s)`} />
              <Row label="You owe suppliers (payables)" value={<M v={position.payables} />} sub={`${payables.length} open bill(s)`} />
              <Row label="Stock value (at cost)" value={<M v={stockValue} />} sub={`${products.length} product(s)`} />
              {position.loans > 0 && <Row label="Loans outstanding" value={<M v={position.loans} />} />}
              <Row label="What the business is worth on paper" sub="Cash + owed to you + stock − owed by you − loans" value={<M v={position.netWorth} bold />} highlight />
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Monthly trends" description="Last 6 months" />
        <CardBody>{trends.length === 0 ? <p className="text-sm text-ink-muted">Not enough history yet.</p> : <TrendChart data={trends} />}</CardBody>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Customer receivables" />
          {receivables.length === 0 ? (
            <CardBody><p className="text-sm text-ink-muted">Nothing owed.</p></CardBody>
          ) : (
            <Table caption="Receivables">
              <thead><tr><Th>Customer</Th><Th>Due</Th><Th align="right">Owed</Th></tr></thead>
              <tbody>
                {receivables.map((r) => (
                  <tr key={r.invoice_id}>
                    <Td>{r.customer_name} <span className="text-xs text-ink-muted">{r.invoice_number}</span></Td>
                    <Td className={r.days_overdue > 0 ? "text-danger" : "text-ink-soft"}>{formatDate(r.due_date)}{r.days_overdue > 0 ? ` (${r.days_overdue}d late)` : ""}</Td>
                    <Td align="right"><M v={r.outstanding_minor} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Supplier payables" />
          {payables.length === 0 ? (
            <CardBody><p className="text-sm text-ink-muted">No unpaid bills.</p></CardBody>
          ) : (
            <Table caption="Payables">
              <thead><tr><Th>Supplier</Th><Th>Due</Th><Th align="right">Owed</Th></tr></thead>
              <tbody>
                {payables.map((b) => (
                  <tr key={b.bill_id}>
                    <Td>{b.supplier_name} <span className="text-xs text-ink-muted">{b.bill_number}</span></Td>
                    <Td className={b.days_overdue > 0 ? "text-danger" : "text-ink-soft"}>{formatDate(b.due_date)}</Td>
                    <Td align="right"><M v={b.outstanding_minor} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Inventory valuation" description="Weighted-average cost" />
        <Table caption="Inventory valuation">
          <thead><tr><Th>Product</Th><Th align="right">Qty</Th><Th align="right">Avg cost</Th><Th align="right">Value</Th></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <Td>{p.name}</Td>
                <Td align="right">{p.quantity_on_hand}</Td>
                <Td align="right">{p.quantity_on_hand > 0 ? <M v={Math.round(p.inventory_value_minor / p.quantity_on_hand)} /> : "—"}</Td>
                <Td align="right"><M v={p.inventory_value_minor} /></Td>
              </tr>
            ))}
            <tr>
              <Td className="font-semibold">Total</Td><Td /><Td />
              <Td align="right"><M v={stockValue} bold /></Td>
            </tr>
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function Row({ label, value, sub, highlight, bar }: { label: string; value: ReactNode; sub?: string; highlight?: boolean; bar?: number }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-2.5 ${highlight ? "bg-canvas/70" : ""}`}>
      <dt className="min-w-0">
        <span className={highlight ? "font-semibold" : ""}>{label}</span>
        {sub && <span className="block text-xs text-ink-muted">{sub}</span>}
        {bar !== undefined && (
          <span className="mt-1 block h-1.5 w-40 max-w-full rounded-full bg-line" aria-hidden>
            <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(bar * 100)}%` }} />
          </span>
        )}
      </dt>
      <dd className="tabular shrink-0 text-right">{value}</dd>
    </div>
  );
}
