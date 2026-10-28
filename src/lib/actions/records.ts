// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { scenarioSchema } from "@/core/validation/scenario";
import {
  customerSchema,
  openingStockSchema,
  productSchema,
  scheduledEventSchema,
  stockAdjustmentSchema,
  supplierSchema,
} from "@/core/validation/forms";
import { canManage, requireBusiness } from "@/lib/context";
import { dbErrorMessage, formToObject, fromDbError, fromZodError, type ActionResult } from "@/lib/errors";

const idSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Customers & suppliers (master data — direct writes protected by RLS)
// ---------------------------------------------------------------------------
export async function saveCustomer(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = customerSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const row = {
    name: parsed.data.name,
    phone: parsed.data.phone ?? null,
    notes: parsed.data.notes ?? null,
    credit_limit_minor: parsed.data.credit_limit,
    payment_terms_days: parsed.data.payment_terms_days ?? null,
  };
  const id = formData.get("id");
  if (typeof id === "string" && idSchema.safeParse(id).success) {
    const { error } = await ctx.supabase.from("customers").update(row).eq("id", id).eq("business_id", ctx.business.id);
    if (error) return fromDbError(error);
    revalidatePath(`/customers/${id}`);
    return { ok: true, message: "Customer updated." };
  }
  const { data, error } = await ctx.supabase.from("customers").insert({ business_id: ctx.business.id, ...row }).select("id").single();
  if (error) return fromDbError(error);
  revalidatePath("/customers");
  const back = formData.get("return_to");
  redirect(typeof back === "string" && back.startsWith("/") && !back.startsWith("//") ? back : `/customers/${data.id}`);
}

export async function saveSupplier(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = supplierSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const row = {
    name: parsed.data.name,
    phone: parsed.data.phone ?? null,
    email: parsed.data.email ?? null,
    notes: parsed.data.notes ?? null,
    payment_terms_days: parsed.data.payment_terms_days ?? null,
  };
  const id = formData.get("id");
  if (typeof id === "string" && idSchema.safeParse(id).success) {
    const { error } = await ctx.supabase.from("suppliers").update(row).eq("id", id).eq("business_id", ctx.business.id);
    if (error) return fromDbError(error);
    revalidatePath(`/suppliers/${id}`);
    return { ok: true, message: "Supplier updated." };
  }
  const { data, error } = await ctx.supabase.from("suppliers").insert({ business_id: ctx.business.id, ...row }).select("id").single();
  if (error) return fromDbError(error);
  revalidatePath("/suppliers");
  redirect(`/suppliers/${data.id}`);
}

// ---------------------------------------------------------------------------
// Products & stock
// ---------------------------------------------------------------------------
export async function saveProduct(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = productSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const d = parsed.data;
  const row = {
    name: d.name,
    sku: d.sku ?? null,
    description: d.description ?? null,
    selling_price_minor: d.selling_price,
    last_unit_cost_minor: d.unit_cost ?? 0,
    low_stock_threshold: d.low_stock_threshold,
    supplier_id: d.supplier_id ?? null,
    barcode: d.barcode ?? null,
    expiry_date: d.expiry_date ?? null,
  };
  const id = formData.get("id");
  if (typeof id === "string" && idSchema.safeParse(id).success) {
    const { error } = await ctx.supabase.from("products").update(row).eq("id", id).eq("business_id", ctx.business.id);
    if (error) return fromDbError(error.code === "23505" ? { code: "P0001", message: "Another product already uses that SKU." } : error);
    revalidatePath(`/inventory/${id}`);
    revalidatePath("/inventory");
    return { ok: true, message: "Product updated." };
  }
  const { data, error } = await ctx.supabase.from("products").insert({ business_id: ctx.business.id, ...row }).select("id").single();
  if (error) return fromDbError(error.code === "23505" ? { code: "P0001", message: "Another product already uses that SKU." } : error);

  // Optional opening stock, posted through the ledger.
  const qty = Number(formData.get("opening_quantity") ?? 0);
  if (Number.isInteger(qty) && qty > 0) {
    const key = formData.get("idempotency_key");
    const { error: stockError } = await ctx.supabase.rpc("record_opening_stock", {
      p_business_id: ctx.business.id,
      p_product_id: data.id,
      p_quantity: qty,
      p_unit_cost_minor: d.unit_cost ?? 0,
      p_txn_date: ctx.today,
      p_idempotency_key: typeof key === "string" && idSchema.safeParse(key).success ? key : crypto.randomUUID(),
    });
    if (stockError) {
      revalidatePath("/inventory");
      return { ok: false, error: `Product saved, but opening stock was not recorded: ${dbErrorMessage(stockError)}` };
    }
  }
  revalidatePath("/inventory");
  redirect(`/inventory/${data.id}?saved=1`);
}

export async function archiveProduct(formData: FormData): Promise<void> {
  const ctx = await requireBusiness();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  const archive = formData.get("archive") !== "false";
  await ctx.supabase.from("products").update({ archived_at: archive ? new Date().toISOString() : null }).eq("id", id.data).eq("business_id", ctx.business.id);
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id.data}`);
}

export async function recordOpeningStock(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = openingStockSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { error } = await ctx.supabase.rpc("record_opening_stock", {
    p_business_id: ctx.business.id,
    p_product_id: parsed.data.product_id,
    p_quantity: parsed.data.quantity,
    p_unit_cost_minor: parsed.data.unit_cost,
    p_txn_date: parsed.data.txn_date,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return fromDbError(error);
  revalidatePath(`/inventory/${parsed.data.product_id}`);
  revalidatePath("/inventory");
  return { ok: true, message: "Opening stock recorded." };
}

export async function recordStockAdjustment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  if (!canManage(ctx.business)) return { ok: false, error: "Only the owner or a manager can adjust stock." };
  const parsed = stockAdjustmentSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const d = parsed.data;
  const { error } = await ctx.supabase.rpc("record_stock_adjustment", {
    p_business_id: ctx.business.id,
    p_product_id: d.product_id,
    p_quantity_delta: d.direction === "add" ? d.quantity : -d.quantity,
    p_reason: d.reason,
    p_txn_date: d.txn_date,
    p_idempotency_key: d.idempotency_key,
    p_unit_cost_minor: d.direction === "add" ? (d.unit_cost ?? null) : null,
  });
  if (error) return fromDbError(error);
  revalidatePath(`/inventory/${d.product_id}`);
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return { ok: true, message: "Stock adjusted." };
}

// ---------------------------------------------------------------------------
// Planned payments, scenarios, alerts
// ---------------------------------------------------------------------------
export async function saveScheduledEvent(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = scheduledEventSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const d = parsed.data;
  if (d.end_date && d.end_date < d.start_date) return { ok: false, error: "End date cannot be before the first date.", fieldErrors: { end_date: "Must be on or after the first date" } };
  const { error } = await ctx.supabase.from("scheduled_cash_events").insert({
    business_id: ctx.business.id,
    direction: d.direction,
    label: d.label,
    category: d.category ?? null,
    amount_minor: d.amount,
    start_date: d.start_date,
    recurrence: d.recurrence,
    end_date: d.end_date ?? null,
    confidence: d.confidence,
  });
  if (error) return fromDbError(error);
  revalidatePath("/cash-flow");
  revalidatePath("/dashboard");
  return { ok: true, message: "Planned payment added to your forecast." };
}

export async function stopScheduledEvent(formData: FormData): Promise<void> {
  const ctx = await requireBusiness();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await ctx.supabase.from("scheduled_cash_events").update({ active: false }).eq("id", id.data).eq("business_id", ctx.business.id);
  revalidatePath("/cash-flow");
  revalidatePath("/dashboard");
}

/** Saving is the ONLY way a scenario is persisted, and it never touches financial records. */
export async function saveScenario(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireBusiness();
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const scenarioId = typeof input === "object" && input && "id" in input && idSchema.safeParse((input as { id: unknown }).id).success ? (input as { id: string }).id : null;
  const { data, error } = await ctx.supabase.rpc("save_cashflow_scenario", {
    p_business_id: ctx.business.id,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_horizon_days: parsed.data.horizon_days,
    p_adjustments: parsed.data.adjustments,
    p_scenario_id: scenarioId,
  });
  if (error) return fromDbError(error);
  revalidatePath("/cash-flow");
  return { ok: true, message: "Scenario saved.", data: { id: data as string } };
}

export async function deleteScenario(formData: FormData): Promise<void> {
  const ctx = await requireBusiness();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await ctx.supabase.from("cashflow_scenarios").delete().eq("id", id.data).eq("business_id", ctx.business.id);
  revalidatePath("/cash-flow");
}

export async function dismissAlert(formData: FormData): Promise<void> {
  const ctx = await requireBusiness();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await ctx.supabase.rpc("dismiss_alert", { p_business_id: ctx.business.id, p_alert_id: id.data });
  revalidatePath("/dashboard");
}

/** Back to the supplier page; failures are reported with a fixed code (never free text in the URL). */
function backToSupplier(supplierId: FormDataEntryValue | null, error?: "post" | "discard"): string {
  const id = idSchema.safeParse(supplierId);
  const base = id.success ? `/suppliers/${id.data}` : "/suppliers";
  return error ? `${base}?bill_error=${error}` : base;
}

export async function discardDraftBill(formData: FormData): Promise<void> {
  const ctx = await requireBusiness();
  const id = idSchema.safeParse(formData.get("bill_id"));
  if (!id.success) return;
  const { error } = await ctx.supabase.rpc("discard_draft_bill", { p_business_id: ctx.business.id, p_bill_id: id.data });
  revalidatePath("/suppliers", "layout");
  if (error) {
    console.error("[bill.discard]", error.code, error.message);
    redirect(backToSupplier(formData.get("supplier_id"), "discard"));
  }
}

export async function postDraftBill(formData: FormData): Promise<void> {
  const ctx = await requireBusiness();
  const id = idSchema.safeParse(formData.get("bill_id"));
  const key = idSchema.safeParse(formData.get("idempotency_key"));
  if (!id.success || !key.success) return;
  const { data, error } = await ctx.supabase.rpc("post_bill", { p_business_id: ctx.business.id, p_bill_id: id.data, p_idempotency_key: key.data });
  revalidatePath("/suppliers", "layout");
  revalidatePath("/dashboard");
  if (error) {
    console.error("[bill.post]", error.code, error.message);
    redirect(backToSupplier(formData.get("supplier_id"), "post"));
  }
  if (data && typeof (data as { transaction_id?: unknown }).transaction_id === "string") {
    redirect(`/transactions/${(data as { transaction_id: string }).transaction_id}?saved=1`);
  }
}
