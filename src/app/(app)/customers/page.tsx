// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { Plus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ReminderButton } from "@/components/forms/people-forms";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate, relativeDay } from "@/core/dates";
import { requireBusiness } from "@/lib/context";
import { getReceivables } from "@/lib/data/finance";
import { listCustomers } from "@/lib/data/records";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const ctx = await requireBusiness();
  const [customers, receivables] = await Promise.all([listCustomers(ctx), getReceivables(ctx)]);
  const currency = ctx.business.currency;

  // Group open invoices by customer: who owes, how much, how long.
  const owing = new Map<string, { total: number; overdue: number; oldestDays: number; nextDue: string; maxOverdue: number; firstInvoice: string }>();
  for (const r of receivables) {
    const o = owing.get(r.customer_id) ?? { total: 0, overdue: 0, oldestDays: 0, nextDue: r.due_date, maxOverdue: 0, firstInvoice: r.invoice_number };
    o.total += r.outstanding_minor;
    if (r.days_overdue > 0) o.overdue += r.outstanding_minor;
    o.oldestDays = Math.max(o.oldestDays, r.days_outstanding);
    o.maxOverdue = Math.max(o.maxOverdue, r.days_overdue);
    if (r.due_date < o.nextDue) o.nextDue = r.due_date;
    owing.set(r.customer_id, o);
  }
  const debtors = customers.filter((c) => owing.has(c.id)).sort((a, b) => owing.get(b.id)!.total - owing.get(a.id)!.total);
  const others = customers.filter((c) => !owing.has(c.id));
  const total = receivables.reduce((s, r) => s + r.outstanding_minor, 0);
  const overdue = receivables.filter((r) => r.days_overdue > 0).reduce((s, r) => s + r.outstanding_minor, 0);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Who owes you, how much, and for how long."
        actions={
          <>
            <LinkButton href="/transactions/new?type=payment" variant="secondary">
              Record a payment
            </LinkButton>
            <LinkButton href="/customers/new">
              <Plus className="size-4" aria-hidden /> New customer
            </LinkButton>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard plainLabel="Customers owe you" term="Receivables" value={total} currency={currency} />
        <StatCard plainLabel="Overdue" term="Past due date" value={overdue} currency={currency} tone={overdue > 0 ? "danger" : "neutral"} />
        <div className="col-span-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-ink-soft shadow-[var(--shadow-card)] lg:col-span-1">
          Money owed to you is <strong>not cash yet</strong>. Your cash forecast counts it on the due date — and stops counting it once it is overdue.
        </div>
      </div>

      <Card className="mb-5">
        <CardHeader title="Who owes you" description={`${debtors.length} customer${debtors.length === 1 ? "" : "s"} with unpaid balances`} />
        {debtors.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />} title="Nobody owes you money">
            When you record a sale with “Pay later”, the customer appears here until they pay.
          </EmptyState>
        ) : (
          <Table caption="Customers who owe money">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th align="right">Owes</Th>
                <Th>Due</Th>
                <Th align="right">Outstanding for</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {debtors.map((c) => {
                const o = owing.get(c.id)!;
                return (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/customers/${c.id}`} className="font-medium hover:text-brand hover:underline">
                        {c.name}
                      </Link>
                    </Td>
                    <Td align="right">
                      <Money value={o.total} currency={currency} className="font-semibold" />
                    </Td>
                    <Td>
                      {o.maxOverdue > 0 ? <Badge tone="danger">Overdue {o.maxOverdue} day{o.maxOverdue === 1 ? "" : "s"}</Badge> : <span className="text-ink-soft">{formatDate(o.nextDue, { year: false })} · {relativeDay(o.nextDue, ctx.today)}</span>}
                    </Td>
                    <Td align="right" className="text-ink-soft">
                      {o.oldestDays} day{o.oldestDays === 1 ? "" : "s"}
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <ReminderButton businessName={ctx.business.name} customerName={c.name} phone={c.phone} amount={o.total} dueDate={o.nextDue} daysOverdue={o.maxOverdue} />
                        <LinkButton href={`/transactions/new?type=payment&customer=${c.id}`} size="sm" variant="secondary">
                          Paid
                        </LinkButton>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {others.length > 0 && (
        <Card>
          <CardHeader title="All other customers" />
          <ul className="divide-y divide-line">
            {others.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex justify-between px-5 py-3 text-sm hover:bg-canvas/60">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-ink-muted">{c.phone ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
