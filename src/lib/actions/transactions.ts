// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import {
  billSchema,
  customerPaymentSchema,
  editDetailsSchema,
  expenseSchema,
  loanRepaymentSchema,
  loanSchema,
  ownerTransactionSchema,
  refundSchema,
  saleSchema,
  stockPurchaseSchema,
  supplierPaymentSchema,
  transferSchema,
  voidSchema,
} from "@/core/validation/forms";
import { requireBusiness } from "@/lib/context";
import { formToObject, fromDbError, fromZodError, type ActionResult } from "@/lib/errors";

/** Pages whose figures change after any financial write. */
function revalidateFinance() {
  for (const path of ["/dashboard", "/transactions", "/cash-flow", "/reports", "/inventory", "/customers", "/suppliers"]) {
    revalidatePath(path, "layout");
  }
}

type RpcCall = (ctx: Awaited<ReturnType<typeof requireBusiness>>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

/**
 * Shared pipeline: validate → call one posting function → revalidate →
 * redirect to the new record (or return a message).
 */
async function post<S extends z.ZodTypeAny>(
  schema: S,
  formData: FormData,
  call: (data: z.infer<S>) => RpcCall,
  opts: { redirectTo?: (result: Record<string, unknown>) => string | null; message?: string } = {},
): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { data, error } = await call(parsed.data)(ctx);
  if (error) return fromDbError(error);
  revalidateFinance();
  const result = (data ?? {}) as Record<string, unknown>;
  const target = opts.redirectTo?.(result) ?? null;
  if (target) redirect(target);
  return { ok: true, message: result.replayed ? "Already recorded — no duplicate was created." : (opts.message ?? "Saved.") };
}

const toTxn = (r: Record<string, unknown>) => (typeof r.transaction_id === "string" ? `/transactions/${r.transaction_id}?saved=1` : "/transactions");

export async function recordSale(_prev: ActionResult, formData: FormData) {
  return post(saleSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_sale", {
      p_business_id: ctx.business.id,
      p_sale_kind: d.sale_kind,
      p_lines: d.lines.map((l) => ({ product_id: l.product_id ?? null, description: l.description ?? null, quantity: l.quantity, unit_price_minor: l.unit_price_minor })),
      p_txn_date: d.txn_date,
      p_idempotency_key: d.idempotency_key,
      p_customer_id: d.customer_id ?? null,
      p_due_date: d.due_date ?? null,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_reference: d.reference ?? null,
      p_notes: d.notes ?? null,
      p_source: formData.get("source") === "ai_confirmed" ? "ai_confirmed" : "manual",
    }), { redirectTo: toTxn });
}

export async function recordCustomerPayment(_prev: ActionResult, formData: FormData) {
  return post(customerPaymentSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_customer_payment", {
      p_business_id: ctx.business.id,
      p_customer_id: d.customer_id,
      p_amount_minor: d.amount,
      p_payment_date: d.payment_date,
      p_idempotency_key: d.idempotency_key,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_invoice_id: d.invoice_id ?? null,
      p_reference: d.reference ?? null,
      p_notes: d.notes ?? null,
      p_source: formData.get("source") === "ai_confirmed" ? "ai_confirmed" : "manual",
    }), { redirectTo: toTxn });
}

export async function recordExpense(_prev: ActionResult, formData: FormData) {
  return post(expenseSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_expense", {
      p_business_id: ctx.business.id,
      p_category: d.category,
      p_amount_minor: d.amount,
      p_txn_date: d.txn_date,
      p_description: d.description ?? d.category,
      p_idempotency_key: d.idempotency_key,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_supplier_id: d.supplier_id ?? null,
      p_reference: d.reference ?? null,
      p_notes: d.notes ?? null,
      p_scheduled_event_id: d.scheduled_event_id ?? null,
      p_occurrence_date: d.occurrence_date ?? null,
      p_source: formData.get("source") === "ai_confirmed" ? "ai_confirmed" : "manual",
    }), { redirectTo: toTxn });
}

export async function recordStockPurchase(_prev: ActionResult, formData: FormData) {
  return post(stockPurchaseSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_stock_purchase", {
      p_business_id: ctx.business.id,
      p_lines: d.lines,
      p_txn_date: d.txn_date,
      p_idempotency_key: d.idempotency_key,
      p_supplier_id: d.supplier_id ?? null,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_reference: d.reference ?? null,
      p_notes: d.notes ?? null,
    }), { redirectTo: toTxn });
}

export async function createBill(_prev: ActionResult, formData: FormData) {
  return post(billSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("create_bill", {
      p_business_id: ctx.business.id,
      p_supplier_id: d.supplier_id,
      p_kind: d.kind,
      p_lines: d.lines.map((l) => ({ product_id: l.product_id ?? null, description: l.description ?? null, quantity: l.quantity, unit_cost_minor: l.unit_cost_minor })),
      p_bill_date: d.bill_date,
      p_due_date: d.due_date ?? null,
      p_idempotency_key: d.idempotency_key,
      p_post: d.post,
      p_category: d.category ?? null,
      p_supplier_reference: d.supplier_reference ?? null,
      p_notes: d.notes ?? null,
    }), { redirectTo: (r) => (r.transaction_id ? toTxn(r) : `/suppliers/${formData.get("supplier_id")}?draft=1`) });
}

export async function recordSupplierPayment(_prev: ActionResult, formData: FormData) {
  return post(supplierPaymentSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_supplier_payment", {
      p_business_id: ctx.business.id,
      p_supplier_id: d.supplier_id,
      p_amount_minor: d.amount,
      p_payment_date: d.payment_date,
      p_idempotency_key: d.idempotency_key,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_bill_id: d.bill_id ?? null,
      p_reference: d.reference ?? null,
      p_notes: d.notes ?? null,
    }), { redirectTo: toTxn });
}

export async function recordLoan(_prev: ActionResult, formData: FormData) {
  return post(loanSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_loan", {
      p_business_id: ctx.business.id,
      p_lender: d.lender,
      p_amount_minor: d.amount,
      p_txn_date: d.txn_date,
      p_idempotency_key: d.idempotency_key,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_notes: d.notes ?? null,
    }), { redirectTo: toTxn });
}

export async function recordLoanRepayment(_prev: ActionResult, formData: FormData) {
  return post(loanRepaymentSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_loan_repayment", {
      p_business_id: ctx.business.id,
      p_loan_id: d.loan_id,
      p_principal_minor: d.principal ?? 0,
      p_interest_minor: d.interest ?? 0,
      p_txn_date: d.txn_date,
      p_idempotency_key: d.idempotency_key,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_notes: d.notes ?? null,
    }), { redirectTo: toTxn });
}

export async function recordOwnerTransaction(_prev: ActionResult, formData: FormData) {
  return post(ownerTransactionSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_owner_transaction", {
      p_business_id: ctx.business.id,
      p_direction: d.direction,
      p_amount_minor: d.amount,
      p_txn_date: d.txn_date,
      p_idempotency_key: d.idempotency_key,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
      p_description: d.description ?? null,
      p_notes: d.notes ?? null,
    }), { redirectTo: toTxn });
}

export async function recordTransfer(_prev: ActionResult, formData: FormData) {
  return post(transferSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_transfer", {
      p_business_id: ctx.business.id,
      p_from_account_id: d.from_account_id,
      p_to_account_id: d.to_account_id,
      p_amount_minor: d.amount,
      p_txn_date: d.txn_date,
      p_idempotency_key: d.idempotency_key,
      p_notes: d.notes ?? null,
    }), { redirectTo: toTxn });
}

export async function recordRefund(_prev: ActionResult, formData: FormData) {
  return post(refundSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("record_refund", {
      p_business_id: ctx.business.id,
      p_invoice_id: d.invoice_id,
      p_lines: d.lines,
      p_restock: d.restock,
      p_txn_date: d.txn_date,
      p_reason: d.reason,
      p_idempotency_key: d.idempotency_key,
      p_payment_method: d.payment_method,
      p_financial_account_id: d.financial_account_id ?? null,
    }), { redirectTo: toTxn });
}

export async function voidTransaction(_prev: ActionResult, formData: FormData) {
  return post(voidSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("void_transaction", {
      p_business_id: ctx.business.id,
      p_transaction_id: d.transaction_id,
      p_reason: d.reason,
      p_idempotency_key: d.idempotency_key,
    }), { message: "Voided. A reversing entry was posted and the original is kept for your records." });
}

export async function editTransactionDetails(_prev: ActionResult, formData: FormData) {
  return post(editDetailsSchema, formData, (d) => (ctx) =>
    ctx.supabase.rpc("update_transaction_details", {
      p_business_id: ctx.business.id,
      p_transaction_id: d.transaction_id,
      p_description: d.description,
      p_reference: d.reference ?? null,
      p_notes: d.notes ?? null,
    }), { message: "Details updated." });
}
