// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import "server-only";
import type { IsoDate } from "@/core/dates";
import type { PaymentMethod, TxnType } from "@/core/finance/types";
import type { AppContext } from "@/lib/context";
import { unwrap } from "./rpc";

export const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export interface TransactionRow {
  id: string;
  type: TxnType;
  status: "posted" | "voided";
  txn_date: IsoDate;
  description: string;
  amount_minor: number;
  category: string | null;
  payment_method: PaymentMethod | null;
  reference: string | null;
  source: string;
  created_at: string;
  customer_id: string | null;
  supplier_id: string | null;
}

const TYPE_GROUPS: Record<string, TxnType[]> = {
  sales: ["cash_sale", "credit_sale", "refund"],
  expenses: ["operating_expense", "supplier_bill"],
  payments: ["customer_payment", "supplier_payment"],
  stock: ["inventory_purchase", "stock_adjustment", "supplier_bill"],
  loans: ["loan_proceeds", "loan_repayment"],
  owner: ["owner_contribution", "owner_withdrawal", "opening_balance"],
  transfers: ["transfer"],
};

export async function listTransactions(
  ctx: AppContext,
  f: { q?: string; type?: string; from?: string; to?: string; page?: number },
): Promise<{ rows: TransactionRow[]; total: number; page: number; pages: number }> {
  const page = f.page ?? 1;
  let query = ctx.supabase
    .from("transactions")
    .select("id, type, status, txn_date, description, amount_minor, category, payment_method, reference, source, created_at, customer_id, supplier_id", {
      count: "exact",
    })
    .eq("business_id", ctx.business.id)
    .neq("type", "void_reversal")
    .order("txn_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (f.type === "voided") query = query.eq("status", "voided");
  else if (f.type && TYPE_GROUPS[f.type]) query = query.in("type", TYPE_GROUPS[f.type]!);
  if (f.from) query = query.gte("txn_date", f.from);
  if (f.to) query = query.lte("txn_date", f.to);
  if (f.q) {
    // Escape PostgREST pattern characters; the value is also parameterised server-side.
    const q = f.q.replace(/[%_,()\\]/g, " ").trim();
    if (q) query = query.or(`description.ilike.%${q}%,reference.ilike.%${q}%`);
  }
  const res = await query;
  const rows = unwrap(res, "transactions") as TransactionRow[];
  const total = res.count ?? rows.length;
  return { rows: rows.map((r) => ({ ...r, amount_minor: Number(r.amount_minor) })), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getTransactionDetail(ctx: AppContext, id: string) {
  const sb = ctx.supabase;
  const [txn, lines, movements, invoice, bill, audit] = await Promise.all([
    sb.from("transactions").select("*, customers(name), suppliers(name), financial_accounts(name)").eq("business_id", ctx.business.id).eq("id", id).maybeSingle(),
    sb.from("ledger_entries").select("account, amount_minor, category, financial_accounts(name)").eq("transaction_id", id).order("id"),
    sb.from("inventory_movements").select("quantity_delta, value_delta_minor, movement_type, products(name)").eq("transaction_id", id).order("id"),
    sb.from("invoices").select("id, invoice_number, status, total_minor, amount_paid_minor, amount_credited_minor, due_date, invoice_lines(id, description, quantity, unit_price_minor, line_total_minor, refunded_quantity)").eq("transaction_id", id).maybeSingle(),
    sb.from("bills").select("id, bill_number, status, total_minor, amount_paid_minor, due_date").eq("transaction_id", id).maybeSingle(),
    sb.from("audit_events").select("action, details, created_at").eq("entity_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (txn.error) throw new Error("Could not load transaction.");
  return {
    txn: txn.data as (TransactionRow & {
      notes: string | null;
      void_reason: string | null;
      voided_at: string | null;
      reversed_by: string | null;
      customers: { name: string } | null;
      suppliers: { name: string } | null;
      financial_accounts: { name: string } | null;
    }) | null,
    lines: (lines.data ?? []) as { account: string; amount_minor: number; category: string | null; financial_accounts: { name: string } | null }[],
    movements: (movements.data ?? []) as { quantity_delta: number; value_delta_minor: number; movement_type: string; products: { name: string } | null }[],
    invoice: invoice.data as {
      id: string;
      invoice_number: string;
      status: string;
      total_minor: number;
      amount_paid_minor: number;
      amount_credited_minor: number;
      due_date: IsoDate;
      invoice_lines: { id: string; description: string; quantity: number; unit_price_minor: number; line_total_minor: number; refunded_quantity: number }[];
    } | null,
    bill: bill.data as { id: string; bill_number: string; status: string; total_minor: number; amount_paid_minor: number; due_date: IsoDate } | null,
    audit: (audit.data ?? []) as { action: string; details: Record<string, unknown>; created_at: string }[],
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  selling_price_minor: number;
  last_unit_cost_minor: number;
  quantity_on_hand: number;
  inventory_value_minor: number;
  low_stock_threshold: number;
  supplier_id: string | null;
  barcode: string | null;
  expiry_date: IsoDate | null;
  archived_at: string | null;
}

const PRODUCT_COLUMNS =
  "id, name, sku, description, selling_price_minor, last_unit_cost_minor, quantity_on_hand, inventory_value_minor, low_stock_threshold, supplier_id, barcode, expiry_date, archived_at";

export async function listProducts(ctx: AppContext, opts: { q?: string; includeArchived?: boolean } = {}): Promise<ProductRow[]> {
  let query = ctx.supabase.from("products").select(PRODUCT_COLUMNS).eq("business_id", ctx.business.id).order("name");
  if (!opts.includeArchived) query = query.is("archived_at", null);
  if (opts.q) {
    const q = opts.q.replace(/[%_,()\\]/g, " ").trim();
    if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`);
  }
  return (unwrap(await query, "products") as ProductRow[]).map((p) => ({
    ...p,
    selling_price_minor: Number(p.selling_price_minor),
    last_unit_cost_minor: Number(p.last_unit_cost_minor),
    inventory_value_minor: Number(p.inventory_value_minor),
  }));
}

export async function getProduct(ctx: AppContext, id: string) {
  const [product, movements] = await Promise.all([
    ctx.supabase.from("products").select(PRODUCT_COLUMNS).eq("business_id", ctx.business.id).eq("id", id).maybeSingle(),
    ctx.supabase
      .from("inventory_movements")
      .select("id, movement_type, movement_date, quantity_delta, value_delta_minor, quantity_after, value_after_minor, note, transaction_id")
      .eq("business_id", ctx.business.id)
      .eq("product_id", id)
      .order("id", { ascending: false })
      .limit(100),
  ]);
  if (product.error) throw new Error("Could not load product.");
  return {
    product: product.data as ProductRow | null,
    movements: (movements.data ?? []) as {
      id: number;
      movement_type: string;
      movement_date: IsoDate;
      quantity_delta: number;
      value_delta_minor: number;
      quantity_after: number;
      value_after_minor: number;
      note: string | null;
      transaction_id: string;
    }[],
  };
}

// ---------------------------------------------------------------------------
// Customers & suppliers
// ---------------------------------------------------------------------------
export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  credit_limit_minor: number | null;
  payment_terms_days: number | null;
  archived_at: string | null;
}

export async function listCustomers(ctx: AppContext): Promise<CustomerRow[]> {
  const res = await ctx.supabase
    .from("customers")
    .select("id, name, phone, notes, credit_limit_minor, payment_terms_days, archived_at")
    .eq("business_id", ctx.business.id)
    .is("archived_at", null)
    .order("name");
  return unwrap(res, "customers") as CustomerRow[];
}

export async function getCustomer(ctx: AppContext, id: string) {
  const [customer, invoices, payments] = await Promise.all([
    ctx.supabase.from("customers").select("id, name, phone, notes, credit_limit_minor, payment_terms_days, archived_at").eq("business_id", ctx.business.id).eq("id", id).maybeSingle(),
    ctx.supabase
      .from("invoices")
      .select("id, invoice_number, sale_kind, issue_date, due_date, total_minor, amount_paid_minor, amount_credited_minor, status, transaction_id")
      .eq("business_id", ctx.business.id)
      .eq("customer_id", id)
      .order("issue_date", { ascending: false })
      .limit(100),
    ctx.supabase
      .from("payments")
      .select("id, amount_minor, payment_date, method, voided_at, transaction_id")
      .eq("business_id", ctx.business.id)
      .eq("customer_id", id)
      .order("payment_date", { ascending: false })
      .limit(100),
  ]);
  if (customer.error) throw new Error("Could not load customer.");
  return {
    customer: customer.data as CustomerRow | null,
    invoices: (invoices.data ?? []) as {
      id: string;
      invoice_number: string;
      sale_kind: "cash" | "credit";
      issue_date: IsoDate;
      due_date: IsoDate;
      total_minor: number;
      amount_paid_minor: number;
      amount_credited_minor: number;
      status: string;
      transaction_id: string;
    }[],
    payments: (payments.data ?? []) as { id: string; amount_minor: number; payment_date: IsoDate; method: PaymentMethod; voided_at: string | null; transaction_id: string }[],
  };
}

export interface SupplierRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  payment_terms_days: number | null;
  archived_at: string | null;
}

export async function listSuppliers(ctx: AppContext): Promise<SupplierRow[]> {
  const res = await ctx.supabase
    .from("suppliers")
    .select("id, name, phone, email, notes, payment_terms_days, archived_at")
    .eq("business_id", ctx.business.id)
    .is("archived_at", null)
    .order("name");
  return unwrap(res, "suppliers") as SupplierRow[];
}

export async function getSupplier(ctx: AppContext, id: string) {
  const [supplier, bills, payments] = await Promise.all([
    ctx.supabase.from("suppliers").select("id, name, phone, email, notes, payment_terms_days, archived_at").eq("business_id", ctx.business.id).eq("id", id).maybeSingle(),
    ctx.supabase
      .from("bills")
      .select("id, bill_number, supplier_reference, kind, bill_date, due_date, total_minor, amount_paid_minor, status, category, transaction_id")
      .eq("business_id", ctx.business.id)
      .eq("supplier_id", id)
      .order("bill_date", { ascending: false })
      .limit(100),
    ctx.supabase
      .from("payments")
      .select("id, amount_minor, payment_date, method, voided_at, transaction_id")
      .eq("business_id", ctx.business.id)
      .eq("supplier_id", id)
      .order("payment_date", { ascending: false })
      .limit(100),
  ]);
  if (supplier.error) throw new Error("Could not load supplier.");
  return {
    supplier: supplier.data as SupplierRow | null,
    bills: (bills.data ?? []) as {
      id: string;
      bill_number: string;
      supplier_reference: string | null;
      kind: "inventory" | "expense";
      bill_date: IsoDate;
      due_date: IsoDate;
      total_minor: number;
      amount_paid_minor: number;
      status: string;
      category: string | null;
      transaction_id: string | null;
    }[],
    payments: (payments.data ?? []) as { id: string; amount_minor: number; payment_date: IsoDate; method: PaymentMethod; voided_at: string | null; transaction_id: string }[],
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------
export interface ScheduledEventRow {
  id: string;
  direction: "in" | "out";
  label: string;
  category: string | null;
  amount_minor: number;
  start_date: IsoDate;
  recurrence: "none" | "weekly" | "monthly";
  end_date: IsoDate | null;
  confidence: "scheduled" | "expected" | "uncertain";
  active: boolean;
}

export async function listScheduledEvents(ctx: AppContext): Promise<ScheduledEventRow[]> {
  const res = await ctx.supabase
    .from("scheduled_cash_events")
    .select("id, direction, label, category, amount_minor, start_date, recurrence, end_date, confidence, active")
    .eq("business_id", ctx.business.id)
    .eq("active", true)
    .order("start_date");
  return unwrap(res, "planned payments") as ScheduledEventRow[];
}

export interface SavedScenario {
  id: string;
  name: string;
  description: string | null;
  horizon_days: number;
  created_at: string;
  cashflow_scenario_events: { kind: string; params: Record<string, unknown>; position: number }[];
}

export async function listScenarios(ctx: AppContext): Promise<SavedScenario[]> {
  const res = await ctx.supabase
    .from("cashflow_scenarios")
    .select("id, name, description, horizon_days, created_at, cashflow_scenario_events(kind, params, position)")
    .eq("business_id", ctx.business.id)
    .order("created_at", { ascending: true });
  return unwrap(res, "scenarios") as SavedScenario[];
}

export async function listLoans(ctx: AppContext) {
  const res = await ctx.supabase.from("loans").select("id, lender, principal_minor, received_date").eq("business_id", ctx.business.id).order("received_date", { ascending: false });
  return unwrap(res, "loans") as { id: string; lender: string; principal_minor: number; received_date: IsoDate }[];
}

export async function listFinancialAccounts(ctx: AppContext) {
  const res = await ctx.supabase.from("financial_accounts").select("id, name, kind, is_default").eq("business_id", ctx.business.id).is("archived_at", null).order("is_default", { ascending: false }).order("name");
  return unwrap(res, "money accounts") as { id: string; name: string; kind: "cash" | "mobile_money" | "bank"; is_default: boolean }[];
}

/** Rebuild saved scenario adjustments ({kind, ...params}) for the engine. */
export function scenarioAdjustments(s: SavedScenario): Record<string, unknown>[] {
  return [...s.cashflow_scenario_events].sort((a, b) => a.position - b.position).map((e) => ({ kind: e.kind, ...e.params }));
}
