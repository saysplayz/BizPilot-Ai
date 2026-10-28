// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { randomUUID } from "node:crypto";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditDetailsButton, RefundButton, VoidButton } from "@/components/forms/correction-forms";
import { LEDGER_LABEL, METHOD_LABEL, TXN_LABEL } from "@/components/txn-labels";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Notice, StatusBadge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { Table, Td, Th } from "@/components/ui/table";
import { formatDate, formatTimestamp } from "@/core/dates";
import { formatMoney } from "@/core/money";
import { canManage, requireBusiness } from "@/lib/context";
import { getTransactionDetail, listFinancialAccounts } from "@/lib/data/records";

export const metadata: Metadata = { title: "Transaction" };

const NOT_VOIDABLE = new Set(["void_reversal", "refund"]);

export default async function TransactionDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireBusiness();
  const [{ txn, lines, movements, invoice, bill, audit }, accounts] = await Promise.all([getTransactionDetail(ctx, id), listFinancialAccounts(ctx)]);
  if (!txn) notFound();
  const currency = ctx.business.currency;
  const manager = canManage(ctx.business);

  return (
    <>
      <Link href="/transactions" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Transactions
      </Link>
      <PageHeader
        title={txn.description}
        description={`${TXN_LABEL[txn.type]} · ${formatDate(txn.txn_date, { weekday: true })}`}
        actions={
          txn.status === "posted" ? (
            <>
              {invoice && manager && invoice.status !== "void" && (
                <RefundButton invoiceId={invoice.id} lines={invoice.invoice_lines} accounts={accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))} today={ctx.today} idempotencyKey={randomUUID()} />
              )}
              <EditDetailsButton transactionId={txn.id} description={txn.description} reference={txn.reference} notes={txn.notes} />
              {manager && !NOT_VOIDABLE.has(txn.type) && <VoidButton transactionId={txn.id} idempotencyKey={randomUUID()} description={txn.description} />}
            </>
          ) : null
        }
      />

      {saved && txn.status === "posted" && (
        <Notice tone="success" className="mb-4">
          Saved. Your dashboard, stock and forecast are updated.
        </Notice>
      )}
      {txn.status === "voided" && (
        <Notice tone="warning" title="This record was voided" className="mb-4">
          {txn.void_reason ? `Reason: ${txn.void_reason}. ` : ""}
          A reversing entry cancelled its effect{txn.voided_at ? ` on ${formatTimestamp(txn.voided_at)}` : ""}. It no longer counts in your figures.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Amount">
                <Money value={txn.amount_minor} currency={currency} className="text-base font-semibold" />
              </Item>
              <Item label="Status">
                <StatusBadge status={txn.status} />
              </Item>
              {txn.customers && <Item label="Customer">{txn.customers.name}</Item>}
              {txn.suppliers && <Item label="Supplier">{txn.suppliers.name}</Item>}
              {txn.payment_method && <Item label="Paid by">{METHOD_LABEL[txn.payment_method]} (recorded by you, not verified)</Item>}
              {txn.financial_accounts && <Item label="Money account">{txn.financial_accounts.name}</Item>}
              {txn.category && <Item label="Category">{txn.category}</Item>}
              {txn.reference && <Item label="Reference">{txn.reference}</Item>}
              {invoice && (
                <Item label="Sale document">
                  {invoice.invoice_number} · <StatusBadge status={invoice.status} />
                  {invoice.status !== "paid" && invoice.status !== "void" && (
                    <span className="ml-1 text-ink-soft">
                      <Money value={invoice.total_minor - invoice.amount_paid_minor - invoice.amount_credited_minor} currency={currency} /> still owed, due {formatDate(invoice.due_date)}
                    </span>
                  )}
                </Item>
              )}
              {bill && (
                <Item label="Bill">
                  {bill.bill_number} · <StatusBadge status={bill.status} />
                </Item>
              )}
              {txn.source !== "manual" && <Item label="Source">{txn.source === "ai_confirmed" ? "Drafted by assistant, confirmed by you" : txn.source === "import" ? "CSV import" : "Demo data"}</Item>}
              {txn.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">Notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">{txn.notes}</dd>
                </div>
              )}
            </dl>
          </CardBody>
          {invoice && invoice.invoice_lines.length > 0 && (
            <Table caption="Items">
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {invoice.invoice_lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      {l.description}
                      {l.refunded_quantity > 0 && <span className="ml-2 text-xs text-warning">{l.refunded_quantity} refunded</span>}
                    </Td>
                    <Td align="right">{l.quantity}</Td>
                    <Td align="right"><Money value={l.unit_price_minor} currency={currency} /></Td>
                    <Td align="right"><Money value={l.line_total_minor} currency={currency} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="What this changed" description="Each record is balanced: what goes up on one side goes down on another." />
            <CardBody className="p-0">
              <ul className="divide-y divide-line text-sm">
                {lines.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>
                      {LEDGER_LABEL[l.account] ?? l.account}
                      {l.financial_accounts && <span className="text-ink-muted"> · {l.financial_accounts.name}</span>}
                      {l.category && l.account === "operating_expense" && <span className="text-ink-muted"> · {l.category}</span>}
                    </span>
                    <span className="tabular text-right text-ink-soft">{describeEffect(l.account, l.amount_minor, currency)}</span>
                  </li>
                ))}
                {lines.length === 0 && <li className="px-5 py-3 text-ink-muted">No money effect.</li>}
              </ul>
            </CardBody>
          </Card>

          {movements.length > 0 && (
            <Card>
              <CardHeader title="Stock movements" />
              <CardBody className="p-0">
                <ul className="divide-y divide-line text-sm">
                  {movements.map((m, i) => (
                    <li key={i} className="flex justify-between px-5 py-2.5">
                      <span>{m.products?.name}</span>
                      <span className={m.quantity_delta < 0 ? "text-danger" : "text-positive"}>
                        {m.quantity_delta > 0 ? "+" : ""}
                        {m.quantity_delta}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {audit.length > 0 && (
            <Card>
              <CardHeader title="History" />
              <CardBody>
                <ol className="space-y-2 text-xs text-ink-soft">
                  {audit.map((a, i) => (
                    <li key={i}>
                      <span className="font-medium text-ink">{a.action.replace(/_/g, " ")}</span> · {formatTimestamp(a.created_at)}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** Explain a debit/credit in owner language ("+GH₵20 cash", "−GH₵20 stock"). */
function describeEffect(account: string, amount: number, currency: string) {
  // Asset/expense accounts increase with debits; liability/equity/revenue accounts increase with credits.
  const debitNormal = ["cash", "accounts_receivable", "inventory", "cogs", "operating_expense", "interest_expense", "sales_returns", "inventory_adjustment"].includes(account);
  const increase = debitNormal ? amount > 0 : amount < 0;
  return `${increase ? "+" : "−"}${formatMoney(Math.abs(amount), { currency })}`;
}
