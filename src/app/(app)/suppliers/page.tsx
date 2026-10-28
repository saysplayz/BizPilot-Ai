// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, EmptyState, StatusBadge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th } from "@/components/ui/table";
import { addDays, formatDate, relativeDay } from "@/core/dates";
import { requireBusiness } from "@/lib/context";
import { getPayables } from "@/lib/data/finance";
import { listSuppliers } from "@/lib/data/records";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const ctx = await requireBusiness();
  const [suppliers, payables] = await Promise.all([listSuppliers(ctx), getPayables(ctx)]);
  const currency = ctx.business.currency;
  const total = payables.reduce((s, p) => s + p.outstanding_minor, 0);
  const overdue = payables.filter((p) => p.days_overdue > 0).reduce((s, p) => s + p.outstanding_minor, 0);
  const week = payables.filter((p) => p.due_date <= addDays(ctx.today, 7)).reduce((s, p) => s + p.outstanding_minor, 0);
  const owedBy = new Map<string, number>();
  for (const p of payables) owedBy.set(p.supplier_id, (owedBy.get(p.supplier_id) ?? 0) + p.outstanding_minor);

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Bills you need to pay and who you buy from."
        actions={
          <>
            <LinkButton href="/transactions/new?type=bill" variant="secondary">
              Add a bill
            </LinkButton>
            <LinkButton href="/suppliers/new">
              <Plus className="size-4" aria-hidden /> New supplier
            </LinkButton>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard plainLabel="You owe suppliers" term="Payables" value={total} currency={currency} />
        <StatCard plainLabel="Due in the next 7 days" value={week} currency={currency} tone={week > 0 ? "warning" : "neutral"} />
        <StatCard plainLabel="Overdue" value={overdue} currency={currency} tone={overdue > 0 ? "danger" : "neutral"} />
      </div>

      <Card className="mb-5">
        <CardHeader title="Unpaid bills" description="Earliest due first" />
        {payables.length === 0 ? (
          <EmptyState icon={<Truck className="size-6" />} title="No unpaid bills">
            When a supplier gives you goods or a service to pay for later, add it as a bill so your forecast knows it is coming.
          </EmptyState>
        ) : (
          <Table caption="Unpaid supplier bills">
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>Bill</Th>
                <Th>Status</Th>
                <Th>Due</Th>
                <Th align="right">Still owed</Th>
                <Th align="right"></Th>
              </tr>
            </thead>
            <tbody>
              {payables.map((b) => (
                <tr key={b.bill_id}>
                  <Td>
                    <Link href={`/suppliers/${b.supplier_id}`} className="font-medium hover:text-brand hover:underline">
                      {b.supplier_name}
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">
                    {b.bill_number} · {b.kind === "inventory" ? "stock" : "expense"}
                  </Td>
                  <Td>{b.days_overdue > 0 ? <Badge tone="danger">Overdue {b.days_overdue}d</Badge> : <StatusBadge status={b.status} />}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">
                    {formatDate(b.due_date, { year: false })} · {relativeDay(b.due_date, ctx.today)}
                  </Td>
                  <Td align="right">
                    <Money value={b.outstanding_minor} currency={currency} className="font-semibold" />
                  </Td>
                  <Td align="right">
                    <LinkButton size="sm" variant="secondary" href={`/transactions/new?type=pay-supplier&supplier=${b.supplier_id}`}>
                      Pay
                    </LinkButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="All suppliers" />
        {suppliers.length === 0 ? (
          <EmptyState title="No suppliers yet" action={<LinkButton href="/suppliers/new">Add a supplier</LinkButton>} />
        ) : (
          <ul className="divide-y divide-line">
            {suppliers.map((s) => (
              <li key={s.id}>
                <Link href={`/suppliers/${s.id}`} className="flex justify-between px-5 py-3 text-sm hover:bg-canvas/60">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-ink-soft">{owedBy.get(s.id) ? <Money value={owedBy.get(s.id)!} currency={currency} /> : s.phone ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
