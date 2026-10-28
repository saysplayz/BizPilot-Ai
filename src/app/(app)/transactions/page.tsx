// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { Plus, Receipt, Search, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cashDirection, METHOD_LABEL, TXN_LABEL } from "@/components/txn-labels";
import { LinkButton } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-styles";
import { Card, PageHeader } from "@/components/ui/card";
import { EmptyState, StatusBadge } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/field";
import { Money } from "@/components/ui/money";
import { Pagination, Table, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/core/dates";
import { TRANSACTION_FILTER_TYPES, transactionFilterSchema } from "@/core/validation/forms";
import { requireBusiness } from "@/lib/context";
import { listTransactions } from "@/lib/data/records";

export const metadata: Metadata = { title: "Transactions" };

const FILTER_LABEL: Record<(typeof TRANSACTION_FILTER_TYPES)[number], string> = {
  all: "All",
  sales: "Sales & refunds",
  expenses: "Expenses & bills",
  payments: "Payments",
  stock: "Stock",
  loans: "Loans",
  owner: "Owner & opening",
  transfers: "Transfers",
  voided: "Voided",
};

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  const f = transactionFilterSchema.parse(raw);
  const ctx = await requireBusiness();
  const { rows, total, page, pages } = await listTransactions(ctx, f);
  const currency = ctx.business.currency;
  const query = (p: number) => {
    const params = new URLSearchParams();
    if (f.q) params.set("q", f.q);
    if (f.type && f.type !== "all") params.set("type", f.type);
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
    params.set("page", String(p));
    return `/transactions?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        description={`${total} record${total === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href="/reports/import" variant="secondary">
              <Upload className="size-4" aria-hidden /> Import CSV
            </LinkButton>
            <LinkButton href="/transactions/new">
              <Plus className="size-4" aria-hidden /> Record
            </LinkButton>
          </>
        }
      />

      <form method="get" className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_150px_150px_auto]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input name="q" defaultValue={f.q} placeholder="Search description or reference" className="pl-9" aria-label="Search" />
        </div>
        <Select name="type" defaultValue={f.type ?? "all"} aria-label="Type">
          {TRANSACTION_FILTER_TYPES.map((t) => (
            <option key={t} value={t}>
              {FILTER_LABEL[t]}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={f.from} aria-label="From date" />
        <Input type="date" name="to" defaultValue={f.to} aria-label="To date" />
        <button type="submit" className={buttonClass("secondary")}>
          Filter
        </button>
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Receipt className="size-6" />} title={f.q || f.from || f.to || (f.type && f.type !== "all") ? "No matching records" : "No transactions yet"} action={<LinkButton href="/transactions/new">Record something</LinkButton>}>
            Sales, expenses, payments and stock movements you record will appear here.
          </EmptyState>
        ) : (
          <>
            <Table caption="Transactions">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th>Type</Th>
                  <Th>Paid by</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const dir = cashDirection(t.type);
                  return (
                    <tr key={t.id} className="hover:bg-canvas/50">
                      <Td className="whitespace-nowrap text-ink-soft">{formatDate(t.txn_date)}</Td>
                      <Td>
                        <Link href={`/transactions/${t.id}`} className="font-medium hover:text-brand hover:underline">
                          {t.description}
                        </Link>
                        {t.reference && <span className="ml-2 text-xs text-ink-muted">#{t.reference}</span>}
                      </Td>
                      <Td>
                        <span className="text-ink-soft">{TXN_LABEL[t.type]}</span> {t.status === "voided" && <StatusBadge status="voided" />}
                        {t.source === "demo" && <span className="ml-1 text-xs text-warning">demo</span>}
                      </Td>
                      <Td className="text-ink-soft">{t.payment_method ? METHOD_LABEL[t.payment_method] : "—"}</Td>
                      <Td align="right">
                        <Money
                          value={dir === "out" ? -t.amount_minor : t.amount_minor}
                          signed={dir !== "none"}
                          tone={t.status === "voided" ? "none" : dir === "in" ? "positive" : "none"}
                          currency={currency}
                          className={t.status === "voided" ? "text-ink-muted line-through" : "font-medium"}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} pages={pages} hrefFor={query} />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-muted">
        + means money came into your cash, Mobile Money or bank; − means it went out. Credit sales and bills change what is owed, not your cash. Payment methods are your own labels and are not verified with any bank or MoMo provider.
      </p>
    </>
  );
}
