// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { fieldErrors } from "../../src/core/validation/fields";
import {
  billSchema,
  businessSetupSchema,
  customerPaymentSchema,
  expenseSchema,
  saleSchema,
  signUpSchema,
  transactionFilterSchema,
  transferSchema,
} from "../../src/core/validation/forms";

const key = randomUUID();
const productId = randomUUID();

describe("13. server-side validation rejects invalid input", () => {
  it("rejects negative and zero amounts", () => {
    const base = { category: "Rent", txn_date: "2026-10-28", payment_method: "cash", idempotency_key: key };
    assert.equal(expenseSchema.safeParse({ ...base, amount: "-100" }).success, false);
    assert.equal(expenseSchema.safeParse({ ...base, amount: "0" }).success, false);
    assert.equal(expenseSchema.safeParse({ ...base, amount: "abc" }).success, false);
    const ok = expenseSchema.safeParse({ ...base, amount: "1,000.50" });
    assert.equal(ok.success, true);
    assert.equal(ok.success && ok.data.amount, 100_050);
  });

  it("rejects invalid dates", () => {
    const base = { category: "Rent", amount: "10", payment_method: "cash", idempotency_key: key };
    for (const d of ["2026-02-30", "28/10/2026", "", "yesterday"]) {
      assert.equal(expenseSchema.safeParse({ ...base, txn_date: d }).success, false, d);
    }
  });

  it("validates sale line items and totals", () => {
    const base = { sale_kind: "cash", txn_date: "2026-10-28", payment_method: "cash", idempotency_key: key };
    const lines = (l: unknown) => JSON.stringify(l);
    assert.equal(saleSchema.safeParse({ ...base, lines: lines([{ product_id: productId, quantity: 2, unit_price_minor: 145_000 }]) }).success, true);
    assert.equal(saleSchema.safeParse({ ...base, lines: lines([]) }).success, false);
    assert.equal(saleSchema.safeParse({ ...base, lines: lines([{ product_id: productId, quantity: 0, unit_price_minor: 100 }]) }).success, false);
    assert.equal(saleSchema.safeParse({ ...base, lines: lines([{ product_id: productId, quantity: 1.5, unit_price_minor: 100 }]) }).success, false);
    assert.equal(saleSchema.safeParse({ ...base, lines: lines([{ description: "x", quantity: 1, unit_price_minor: -1 }]) }).success, false);
    assert.equal(saleSchema.safeParse({ ...base, lines: lines([{ quantity: 1, unit_price_minor: 100 }]) }).success, false, "needs product or description");
    assert.equal(saleSchema.safeParse({ ...base, lines: "not json" }).success, false);
  });

  it("requires a customer for credit sales and a due date on/after the sale", () => {
    const base = { sale_kind: "credit", txn_date: "2026-10-28", payment_method: "cash", idempotency_key: key, lines: JSON.stringify([{ description: "Phone", quantity: 1, unit_price_minor: 100 }]) };
    const noCustomer = saleSchema.safeParse(base);
    assert.equal(noCustomer.success, false);
    assert.equal(!noCustomer.success && fieldErrors(noCustomer.error).customer_id, "Choose the customer who will pay later");
    assert.equal(saleSchema.safeParse({ ...base, customer_id: randomUUID(), due_date: "2026-10-27" }).success, false);
    assert.equal(saleSchema.safeParse({ ...base, customer_id: randomUUID(), due_date: "2026-11-07" }).success, true);
  });

  it("validates payments, transfers and bills", () => {
    assert.equal(customerPaymentSchema.safeParse({ customer_id: "not-a-uuid", amount: "10", payment_date: "2026-10-28", payment_method: "cash", idempotency_key: key }).success, false);
    const acct = randomUUID();
    assert.equal(transferSchema.safeParse({ from_account_id: acct, to_account_id: acct, amount: "10", txn_date: "2026-10-28", idempotency_key: key }).success, false);
    const bill = { supplier_id: randomUUID(), kind: "inventory", bill_date: "2026-10-28", post: "post", idempotency_key: key };
    assert.equal(billSchema.safeParse({ ...bill, lines: JSON.stringify([{ description: "Rent", quantity: 1, unit_cost_minor: 100 }]) }).success, false, "stock lines need products");
    assert.equal(billSchema.safeParse({ ...bill, kind: "expense", lines: JSON.stringify([{ description: "Rent", quantity: 1, unit_cost_minor: 100 }]) }).success, true);
  });

  it("rejects requests without an idempotency key", () => {
    assert.equal(expenseSchema.safeParse({ category: "Rent", amount: "10", txn_date: "2026-10-28", payment_method: "cash" }).success, false);
  });

  it("validates onboarding with optional fields skipped", () => {
    const r = businessSetupSchema.safeParse({ name: "Kofi's Phones", business_type: "electronics", opening_cash: "", min_cash_reserve: "" });
    assert.equal(r.success, true);
    assert.equal(r.success && r.data.opening_cash, null);
    assert.equal(r.success && r.data.currency, "GHS");
    assert.equal(businessSetupSchema.safeParse({ name: "  ", business_type: "electronics" }).success, false);
    assert.equal(businessSetupSchema.safeParse({ name: "x", business_type: "spaceships" }).success, false);
  });

  it("enforces password rules", () => {
    assert.equal(signUpSchema.safeParse({ full_name: "Ama", email: "ama@example.com", password: "short1" }).success, false);
    assert.equal(signUpSchema.safeParse({ full_name: "Ama", email: "ama@example.com", password: "longenoughbutnodigits" }).success, false);
    assert.equal(signUpSchema.safeParse({ full_name: "Ama", email: "ama@example.com", password: "akwaaba2026" }).success, true);
  });

  it("degrades malformed list filters to safe defaults", () => {
    const r = transactionFilterSchema.parse({ type: "bogus", page: "-4", from: "nope" });
    assert.equal(r.type, "all");
    assert.equal(r.page, 1);
    assert.equal(r.from, undefined);
  });
});
