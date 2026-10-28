// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { randomUUID } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SupplierForm } from "@/components/forms/people-forms";
import { METHOD_LABEL } from "@/components/txn-labels";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, Notice, StatusBadge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/core/dates";
import { discardDraftBill, postDraftBill } from "@/lib/actions/records";
import { requireBusiness } from "@/lib/context";
import { getSupplier } from "@/lib/data/records";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string; bill_error?: string }> }) {
  const { id } = await params;
  const { draft, bill_error: billError } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireBusiness();
  const { supplier, bills, payments } = await getSupplier(ctx, id);
  if (!supplier) notFound();
  const currency = ctx.business.currency;
  const open = bills.filter((b) => b.status === "open" || b.status === "partially_paid");
  const owed = open.reduce((s, b) => s + b.total_minor - b.amount_paid_minor, 0);

  return (
    <>
      <Link href="/suppliers" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Suppliers
      </Link>
      <PageHeader
        title={supplier.name}
        description={[supplier.phone, supplier.email].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <LinkButton href={`/transactions/new?type=bill&supplier=${supplier.id}`} variant="secondary">
              Add bill
            </LinkButton>
            {owed > 0 && <LinkButton href={`/transactions/new?type=pay-supplier&supplier=${supplier.id}`}>Pay supplier</LinkButton>}
          </>
        }
      />
      {billError && (
        <Notice tone="danger" className="mb-4">
          {billError === "post"
            ? "That draft bill could not be posted, so nothing was recorded. Refresh the page and try again; if it keeps failing, discard it and enter the bill again."
            : "That draft bill could not be discarded. It may already have been posted."}
        </Notice>
      )}
      {draft && (
        <Notice tone="success" className="mb-4">
          Draft bill saved. It won&apos;t affect your figures until you post it.
        </Notice>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard plainLabel="You owe" term="Outstanding bills" value={owed} currency={currency} tone={owed > 0 ? "warning" : "neutral"} />
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="text-[13px] font-medium text-ink-soft">Unpaid bills</p>
          <p className="text-xl font-semibold">{open.length}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="text-[13px] font-medium text-ink-soft">Payment terms</p>
          <p className="text-xl font-semibold">{supplier.payment_terms_days ?? 0} days</p>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Bills" />
            {bills.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-muted">No bills yet.</p>
              </CardBody>
            ) : (
              <Table caption="Bills from this supplier">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Bill</Th>
                    <Th>Status</Th>
                    <Th>Due</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Still owed</Th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => {
                    const overdue = (b.status === "open" || b.status === "partially_paid") && b.due_date < ctx.today;
                    return (
                      <tr key={b.id}>
                        <Td className="whitespace-nowrap text-ink-soft">{formatDate(b.bill_date)}</Td>
                        <Td>
                          {b.transaction_id ? (
                            <Link href={`/transactions/${b.transaction_id}`} className="hover:text-brand hover:underline">
                              {b.bill_number}
                            </Link>
                          ) : (
                            b.bill_number
                          )}
                          {b.supplier_reference && <span className="ml-1 text-xs text-ink-muted">({b.supplier_reference})</span>}
                          <span className="block text-xs text-ink-muted">{b.kind === "inventory" ? "Stock" : (b.category ?? "Expense")}</span>
                        </Td>
                        <Td>
                          {overdue ? <Badge tone="danger">Overdue</Badge> : <StatusBadge status={b.status} />}
                          {b.status === "draft" && (
                            <div className="mt-1.5 flex gap-1.5">
                              <form action={postDraftBill}>
                                <input type="hidden" name="bill_id" value={b.id} />
                                <input type="hidden" name="supplier_id" value={supplier.id} />
                                <input type="hidden" name="idempotency_key" value={randomUUID()} />
                                <Button size="sm" type="submit">
                                  Post
                                </Button>
                              </form>
                              <form action={discardDraftBill}>
                                <input type="hidden" name="bill_id" value={b.id} />
                                <input type="hidden" name="supplier_id" value={supplier.id} />
                                <Button size="sm" variant="ghost" type="submit">
                                  Discard
                                </Button>
                              </form>
                            </div>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap text-ink-soft">{formatDate(b.due_date)}</Td>
                        <Td align="right"><Money value={b.total_minor} currency={currency} /></Td>
                        <Td align="right">
                          {b.status === "void" || b.status === "draft" ? "—" : <Money value={b.total_minor - b.amount_paid_minor} currency={currency} className={b.total_minor > b.amount_paid_minor ? "font-semibold" : "text-ink-muted"} />}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Payments made" />
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
                      <Money value={p.amount_minor} currency={currency} className={p.voided_at ? "text-ink-muted line-through" : "font-medium"} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Supplier details" />
          <CardBody>
            <SupplierForm supplier={supplier} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
