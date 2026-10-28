// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { BillForm, CustomerPaymentForm, ExpenseForm, LoanForm, LoanRepaymentForm, OwnerMoneyForm, StockPurchaseForm, SupplierPaymentForm, TransferForm } from "@/components/forms/money-forms";
import { SaleForm } from "@/components/forms/sale-form";
import { Card, CardBody, PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/feedback";
import { isIsoDate } from "@/core/dates";
import { requireBusiness } from "@/lib/context";
import { loadFormOptions } from "@/lib/data/form-options";

export const metadata: Metadata = { title: "Record" };

const TYPES = [
  { key: "sale", label: "Sale", hint: "Paid now or on credit", group: "Money in" },
  { key: "payment", label: "Customer paid", hint: "Money owed to you", group: "Money in" },
  { key: "expense", label: "Expense", hint: "Transport, rent, bills…", group: "Money out" },
  { key: "stock", label: "Stock bought", hint: "Paid now", group: "Money out" },
  { key: "bill", label: "Supplier bill", hint: "Pay later", group: "Money out" },
  { key: "pay-supplier", label: "Paid supplier", hint: "Clear a bill", group: "Money out" },
  { key: "loan", label: "Loan received", hint: "Not income", group: "Other" },
  { key: "repay", label: "Loan repayment", hint: "Principal + interest", group: "Other" },
  { key: "owner", label: "Owner money", hint: "In or out", group: "Other" },
  { key: "transfer", label: "Transfer", hint: "Between your accounts", group: "Other" },
] as const;

type Search = { type?: string; customer?: string; supplier?: string; amount?: string; description?: string; category?: string; date?: string; from?: string };

export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();
  const type = TYPES.some((t) => t.key === sp.type) ? sp.type! : "sale";
  const opts = await loadFormOptions(ctx);
  const key = randomUUID();
  const fromAi = sp.from === "assistant";
  // Prefill only from simple, validated values (e.g. a record drafted by the assistant).
  const prefill = {
    amount: sp.amount && /^\d{1,10}(\.\d{1,2})?$/.test(sp.amount) ? sp.amount : undefined,
    description: sp.description?.slice(0, 200),
    category: sp.category?.slice(0, 60),
    date: sp.date && isIsoDate(sp.date) ? sp.date : undefined,
    source: fromAi ? "ai_confirmed" : undefined,
  };
  const common = { today: ctx.today, idempotencyKey: key };

  return (
    <>
      <PageHeader title="Record" description="Choose what happened. Everything is saved in one step and can be corrected later." />
      {fromAi && (
        <Notice tone="info" className="mb-4" title="Drafted by the assistant">
          Check the details below. Nothing is saved until you press the button.
        </Notice>
      )}
      <nav aria-label="What to record" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TYPES.map((t) => (
          <Link
            key={t.key}
            href={`/transactions/new?type=${t.key}`}
            aria-current={type === t.key ? "page" : undefined}
            className={cn("rounded-lg border px-3 py-2.5 transition-colors", type === t.key ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-line-strong")}
          >
            <span className="block text-sm font-semibold">{t.label}</span>
            <span className="block text-xs text-ink-muted">{t.hint}</span>
          </Link>
        ))}
      </nav>
      <Card>
        <CardBody className="py-5">
          {type === "sale" && <SaleForm {...common} products={opts.products} customers={opts.customers} accounts={opts.accounts} prefill={prefill} />}
          {type === "payment" && <CustomerPaymentForm {...common} customers={opts.customers} invoices={opts.invoices} accounts={opts.accounts} defaultCustomerId={sp.customer} prefill={prefill} />}
          {type === "expense" && <ExpenseForm {...common} accounts={opts.accounts} suppliers={opts.suppliers} planned={opts.planned} prefill={prefill} />}
          {type === "stock" && <StockPurchaseForm {...common} products={opts.products} suppliers={opts.suppliers} accounts={opts.accounts} />}
          {type === "bill" && <BillForm {...common} products={opts.products} suppliers={opts.suppliers} defaultSupplierId={sp.supplier} />}
          {type === "pay-supplier" && <SupplierPaymentForm {...common} suppliers={opts.suppliers} bills={opts.bills} accounts={opts.accounts} defaultSupplierId={sp.supplier} />}
          {type === "loan" && <LoanForm {...common} accounts={opts.accounts} />}
          {type === "repay" && <LoanRepaymentForm {...common} loans={opts.loans} accounts={opts.accounts} />}
          {type === "owner" && <OwnerMoneyForm {...common} accounts={opts.accounts} />}
          {type === "transfer" && <TransferForm {...common} accounts={opts.accounts} />}
        </CardBody>
      </Card>
    </>
  );
}
