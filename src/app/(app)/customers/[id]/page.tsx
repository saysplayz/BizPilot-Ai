// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerForm, ReminderButton } from "@/components/forms/people-forms";
import { METHOD_LABEL } from "@/components/txn-labels";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th } from "@/components/ui/table";
import { diffDays, formatDate } from "@/core/dates";
import { requireBusiness } from "@/lib/context";
import { getCustomer } from "@/lib/data/records";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireBusiness();
  const { customer, invoices, payments } = await getCustomer(ctx, id);
  if (!customer) notFound();
  const currency = ctx.business.currency;
  const open = invoices.filter((i) => i.status === "open" || i.status === "partially_paid");
  const owed = open.reduce((s, i) => s + (i.total_minor - i.amount_paid_minor - i.amount_credited_minor), 0);
  const oldestOpen = [...open].sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
  const daysOverdue = oldestOpen ? Math.max(0, diffDays(oldestOpen.due_date, ctx.today)) : 0;
  const lifetime = invoices.filter((i) => i.status !== "void").reduce((s, i) => s + i.total_minor - i.amount_credited_minor, 0);

  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>
      <PageHeader
        title={customer.name}
        description={customer.phone ?? undefined}
        actions={
          <>
            {owed > 0 && oldestOpen && (
              <ReminderButton businessName={ctx.business.name} customerName={customer.name} phone={customer.phone} amount={owed} dueDate={oldestOpen.due_date} daysOverdue={daysOverdue} invoiceNumber={open.length === 1 ? oldestOpen.invoice_number : undefined} />
            )}
            {owed > 0 && <LinkButton href={`/transactions/new?type=payment&customer=${customer.id}`}>Record payment</LinkButton>}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard plainLabel="Owes you now" term="Outstanding balance" value={owed} currency={currency} tone={daysOverdue > 0 ? "danger" : owed > 0 ? "warning" : "neutral"} hint={daysOverdue > 0 ? `Overdue ${daysOverdue} days` : oldestOpen ? `Next due ${formatDate(oldestOpen.due_date)}` : undefined} />
        <StatCard plainLabel="Credit limit" value={customer.credit_limit_minor} currency={currency} hint={customer.credit_limit_minor === null ? "No limit set" : undefined} />
        <StatCard plainLabel="Total bought" term="Lifetime sales" value={lifetime} currency={currency} />
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="text-[13px] font-medium text-ink-soft">Payment terms</p>
          <p className="text-xl font-semibold">{customer.payment_terms_days ?? 7} days</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Sales" />
            {invoices.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-muted">No sales recorded for this customer.</p>
              </CardBody>
            ) : (
              <Table caption="Sales to this customer">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Invoice</Th>
                    <Th>Status</Th>
                    <Th>Due</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Still owed</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => {
                    const left = i.total_minor - i.amount_paid_minor - i.amount_credited_minor;
                    const overdue = (i.status === "open" || i.status === "partially_paid") && i.due_date < ctx.today;
                    return (
                      <tr key={i.id}>
                        <Td className="whitespace-nowrap text-ink-soft">{formatDate(i.issue_date)}</Td>
                        <Td>
                          <Link href={`/transactions/${i.transaction_id}`} className="hover:text-brand hover:underline">
                            {i.invoice_number}
                          </Link>
                          {i.sale_kind === "cash" && <span className="ml-1 text-xs text-ink-muted">(paid at sale)</span>}
                        </Td>
                        <Td>{overdue ? <Badge tone="danger">Overdue</Badge> : <StatusBadge status={i.status} />}</Td>
                        <Td className="whitespace-nowrap text-ink-soft">{i.sale_kind === "credit" ? formatDate(i.due_date) : "—"}</Td>
                        <Td align="right"><Money value={i.total_minor} currency={currency} /></Td>
                        <Td align="right">{i.status === "void" ? "—" : <Money value={left} currency={currency} className={left > 0 ? "font-semibold" : "text-ink-muted"} />}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Payments received" />
            {payments.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-muted">No payments recorded.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/transactions/${p.transaction_id}`} className="flex justify-between px-5 py-3 hover:bg-canvas/60">
                      <span>
                        {formatDate(p.payment_date)} · {METHOD_LABEL[p.method]} {p.voided_at && <Badge>Voided</Badge>}
                      </span>
                      <Money value={p.amount_minor} currency={currency} className={p.voided_at ? "text-ink-muted line-through" : "font-medium text-positive"} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Customer details" />
          <CardBody>
            <CustomerForm customer={customer} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
