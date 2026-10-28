// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * Server-side validation for every write the app performs. Server actions
 * parse FormData with these schemas before calling the database, and the
 * database re-checks every rule (defence in depth).
 */
import { z } from "zod";
import { BUSINESS_TYPES } from "../finance/types";
import {
  idempotencyKey,
  isoDate,
  jsonArray,
  minorInt,
  money,
  optionalIsoDate,
  optionalMoney,
  optionalPhone,
  optionalText,
  optionalUuid,
  paymentMethod,
  quantity,
  requiredText,
  uuid,
} from "./fields";

// --------------------------------------------------------------------------
// Auth & onboarding
// --------------------------------------------------------------------------
export const signUpSchema = z.object({
  full_name: requiredText("Your name", 120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(128, "Password is too long")
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letters and at least one number"),
});

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const businessSetupSchema = z.object({
  name: requiredText("Business name", 120),
  business_type: z.enum(BUSINESS_TYPES, { errorMap: () => ({ message: "Choose a business type" }) }),
  currency: z.literal("GHS").default("GHS"),
  opening_cash: optionalMoney(),
  min_cash_reserve: optionalMoney(),
});

export const businessSettingsSchema = z.object({
  name: requiredText("Business name", 120),
  business_type: z.enum(BUSINESS_TYPES),
  min_cash_reserve: optionalMoney(),
});

export const openingBalanceSchema = z.object({
  financial_account_id: uuid("Account"),
  amount: money({ allowZero: true, label: "Opening balance" }),
  txn_date: isoDate(),
  idempotency_key: idempotencyKey,
});

// --------------------------------------------------------------------------
// Sales & receivables
// --------------------------------------------------------------------------
export const saleLineSchema = z
  .object({
    product_id: z.string().uuid().nullable().optional(),
    description: z.string().trim().max(200).optional(),
    quantity: z.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero").max(100_000),
    unit_price_minor: minorInt("Price"),
  })
  .refine((l) => Boolean(l.product_id) || Boolean(l.description), { message: "Each item needs a product or a description" });

export const saleSchema = z
  .object({
    sale_kind: z.enum(["cash", "credit"]),
    txn_date: isoDate("Sale date"),
    customer_id: optionalUuid("Customer"),
    due_date: optionalIsoDate("Due date"),
    payment_method: paymentMethod.default("cash"),
    financial_account_id: optionalUuid("Account"),
    reference: optionalText(80),
    notes: optionalText(1000),
    lines: jsonArray(saleLineSchema, { label: "Items" }),
    idempotency_key: idempotencyKey,
  })
  .refine((v) => v.sale_kind === "cash" || Boolean(v.customer_id), { message: "Choose the customer who will pay later", path: ["customer_id"] })
  .refine((v) => !v.due_date || v.due_date >= v.txn_date, { message: "Due date cannot be before the sale date", path: ["due_date"] })
  .refine((v) => Array.isArray(v.lines) && v.lines.reduce((s, l) => s + l.quantity * l.unit_price_minor, 0) > 0, {
    message: "Sale total must be greater than zero",
    path: ["lines"],
  });

export const customerPaymentSchema = z.object({
  customer_id: uuid("Customer"),
  amount: money({ label: "Payment amount" }),
  payment_date: isoDate("Payment date"),
  payment_method: paymentMethod,
  financial_account_id: optionalUuid("Account"),
  invoice_id: optionalUuid("Invoice"),
  reference: optionalText(80),
  notes: optionalText(1000),
  idempotency_key: idempotencyKey,
});

export const refundSchema = z.object({
  invoice_id: uuid("Sale"),
  lines: jsonArray(z.object({ invoice_line_id: z.string().uuid(), quantity: z.number().int().positive() }), { label: "Items" }),
  restock: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  txn_date: isoDate("Refund date"),
  reason: requiredText("Reason", 500),
  payment_method: paymentMethod.default("cash"),
  financial_account_id: optionalUuid("Account"),
  idempotency_key: idempotencyKey,
});

// --------------------------------------------------------------------------
// Purchases, bills & payables
// --------------------------------------------------------------------------
export const purchaseLineSchema = z.object({
  product_id: z.string().uuid("Choose a product"),
  quantity: z.number().int().positive("Quantity must be greater than zero").max(100_000),
  unit_cost_minor: minorInt("Cost"),
});

export const stockPurchaseSchema = z.object({
  txn_date: isoDate("Purchase date"),
  supplier_id: optionalUuid("Supplier"),
  payment_method: paymentMethod,
  financial_account_id: optionalUuid("Account"),
  reference: optionalText(80),
  notes: optionalText(1000),
  lines: jsonArray(purchaseLineSchema, { label: "Items" }),
  idempotency_key: idempotencyKey,
});

export const billLineSchema = z.object({
  product_id: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(200).optional(),
  quantity: z.number().int().positive().max(100_000),
  unit_cost_minor: minorInt("Cost"),
});

export const billSchema = z
  .object({
    supplier_id: uuid("Supplier"),
    kind: z.enum(["inventory", "expense"]),
    bill_date: isoDate("Bill date"),
    due_date: optionalIsoDate("Due date"),
    category: optionalText(60),
    supplier_reference: optionalText(80),
    notes: optionalText(1000),
    post: z.preprocess((v) => v !== "draft" && v !== false, z.boolean()),
    lines: jsonArray(billLineSchema, { label: "Lines" }),
    idempotency_key: idempotencyKey,
  })
  .refine((v) => v.kind === "expense" || (Array.isArray(v.lines) && v.lines.every((l) => Boolean(l.product_id))), {
    message: "Each stock line needs a product",
    path: ["lines"],
  })
  .refine((v) => v.kind === "inventory" || (Array.isArray(v.lines) && v.lines.every((l) => Boolean(l.description))), {
    message: "Each expense line needs a description",
    path: ["lines"],
  })
  .refine((v) => !v.due_date || v.due_date >= v.bill_date, { message: "Due date cannot be before the bill date", path: ["due_date"] });

export const supplierPaymentSchema = z.object({
  supplier_id: uuid("Supplier"),
  amount: money({ label: "Payment amount" }),
  payment_date: isoDate("Payment date"),
  payment_method: paymentMethod,
  financial_account_id: optionalUuid("Account"),
  bill_id: optionalUuid("Bill"),
  reference: optionalText(80),
  notes: optionalText(1000),
  idempotency_key: idempotencyKey,
});

// --------------------------------------------------------------------------
// Expenses, loans, owner money, transfers
// --------------------------------------------------------------------------
export const EXPENSE_CATEGORIES = [
  "Rent",
  "Wages",
  "Transport",
  "Utilities",
  "Internet & phone",
  "Repairs",
  "Marketing",
  "Security & cleaning",
  "Bank & MoMo charges",
  "Taxes & levies",
  "Other",
] as const;

export const expenseSchema = z
  .object({
    category: requiredText("Category", 60),
    amount: money({ label: "Expense amount" }),
    txn_date: isoDate("Expense date"),
    description: optionalText(200),
    payment_method: paymentMethod,
    financial_account_id: optionalUuid("Account"),
    supplier_id: optionalUuid("Supplier"),
    reference: optionalText(80),
    notes: optionalText(1000),
    scheduled_event_id: optionalUuid("Planned payment"),
    occurrence_date: optionalIsoDate("Planned payment date"),
    idempotency_key: idempotencyKey,
  })
  .refine((v) => !v.scheduled_event_id || Boolean(v.occurrence_date), {
    message: "Choose which date of the planned payment this settles",
    path: ["occurrence_date"],
  });

export const loanSchema = z.object({
  lender: requiredText("Lender", 120),
  amount: money({ label: "Loan amount" }),
  txn_date: isoDate("Date received"),
  payment_method: paymentMethod.default("bank_transfer"),
  financial_account_id: optionalUuid("Account"),
  notes: optionalText(1000),
  idempotency_key: idempotencyKey,
});

export const loanRepaymentSchema = z
  .object({
    loan_id: uuid("Loan"),
    principal: optionalMoney(),
    interest: optionalMoney(),
    txn_date: isoDate("Repayment date"),
    payment_method: paymentMethod.default("bank_transfer"),
    financial_account_id: optionalUuid("Account"),
    notes: optionalText(1000),
    idempotency_key: idempotencyKey,
  })
  .refine((v) => (v.principal ?? 0) + (v.interest ?? 0) > 0, { message: "Enter the principal and/or interest paid", path: ["principal"] });

export const ownerTransactionSchema = z.object({
  direction: z.enum(["in", "out"]),
  amount: money(),
  txn_date: isoDate(),
  payment_method: paymentMethod,
  financial_account_id: optionalUuid("Account"),
  description: optionalText(200),
  notes: optionalText(1000),
  idempotency_key: idempotencyKey,
});

export const transferSchema = z
  .object({
    from_account_id: uuid("From account"),
    to_account_id: uuid("To account"),
    amount: money({ label: "Transfer amount" }),
    txn_date: isoDate(),
    notes: optionalText(1000),
    idempotency_key: idempotencyKey,
  })
  .refine((v) => v.from_account_id !== v.to_account_id, { message: "Choose two different accounts", path: ["to_account_id"] });

// --------------------------------------------------------------------------
// Inventory
// --------------------------------------------------------------------------
export const productSchema = z.object({
  name: requiredText("Product name", 120),
  sku: optionalText(60),
  description: optionalText(1000),
  selling_price: money({ allowZero: true, label: "Selling price" }),
  unit_cost: optionalMoney(),
  low_stock_threshold: z.coerce.number().int("Use a whole number").min(0, "Cannot be negative").max(1_000_000).default(0),
  supplier_id: optionalUuid("Supplier"),
  barcode: optionalText(64),
  expiry_date: optionalIsoDate("Expiry date"),
});

export const openingStockSchema = z.object({
  product_id: uuid("Product"),
  quantity: quantity(),
  unit_cost: money({ allowZero: true, label: "Unit cost" }),
  txn_date: isoDate(),
  idempotency_key: idempotencyKey,
});

export const stockAdjustmentSchema = z.object({
  product_id: uuid("Product"),
  direction: z.enum(["add", "remove"]),
  quantity: quantity(),
  unit_cost: optionalMoney(),
  reason: requiredText("Reason", 500),
  txn_date: isoDate(),
  idempotency_key: idempotencyKey,
});

// --------------------------------------------------------------------------
// People
// --------------------------------------------------------------------------
export const customerSchema = z.object({
  name: requiredText("Customer name", 120),
  phone: optionalPhone,
  notes: optionalText(1000),
  credit_limit: optionalMoney(),
  payment_terms_days: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 365), "Use 0–365 days"),
});

export const supplierSchema = z.object({
  name: requiredText("Supplier name", 120),
  phone: optionalPhone,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, "Enter a valid email"),
  notes: optionalText(1000),
  payment_terms_days: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .refine((v) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 365), "Use 0–365 days"),
});

// --------------------------------------------------------------------------
// Cash-flow planning
// --------------------------------------------------------------------------
export const scheduledEventSchema = z.object({
  direction: z.enum(["in", "out"]),
  label: requiredText("Name", 120),
  category: optionalText(60),
  amount: money(),
  start_date: isoDate("First date"),
  recurrence: z.enum(["none", "weekly", "monthly"]),
  end_date: optionalIsoDate("End date"),
  confidence: z.enum(["scheduled", "expected", "uncertain"]).default("scheduled"),
});

// --------------------------------------------------------------------------
// Corrections
// --------------------------------------------------------------------------
export const voidSchema = z.object({
  transaction_id: uuid("Transaction"),
  reason: requiredText("Reason for voiding", 500),
  idempotency_key: idempotencyKey,
});

export const editDetailsSchema = z.object({
  transaction_id: uuid("Transaction"),
  description: requiredText("Description", 200),
  reference: optionalText(80),
  notes: optionalText(1000),
});

// --------------------------------------------------------------------------
// Listing / filtering (URL search params)
// --------------------------------------------------------------------------
export const TRANSACTION_FILTER_TYPES = ["all", "sales", "expenses", "payments", "stock", "loans", "owner", "transfers", "voided"] as const;

export const transactionFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(TRANSACTION_FILTER_TYPES).optional().catch("all"),
  from: optionalIsoDate().catch(undefined),
  to: optionalIsoDate().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(1),
});
