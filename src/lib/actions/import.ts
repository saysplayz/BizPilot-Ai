// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  MAX_IMPORT_ROWS,
  validateProductRows,
  validateTransactionRows,
  type ImportProductRow,
  type ImportTransactionRow,
} from "@/core/import/csv";
import { requireBusiness } from "@/lib/context";
import { dbErrorMessage, type ActionResult } from "@/lib/errors";

const payloadSchema = z.object({
  kind: z.enum(["transactions", "products"]),
  rows: z.array(z.array(z.string().max(1000)).max(50)).max(MAX_IMPORT_ROWS),
  mapping: z.record(z.string(), z.number().int().min(0).max(49)),
});

export interface ImportSummary {
  imported: number;
  skippedDuplicates: number;
  failed: { row: number; message: string }[];
}

/**
 * Confirmed import. The client's preview is never trusted: rows are
 * re-validated here from the raw CSV cells + mapping, then each row is posted
 * through the normal posting functions with a fingerprint the database
 * refuses to post twice.
 */
export async function runImport(input: unknown): Promise<ActionResult<ImportSummary>> {
  const ctx = await requireBusiness();
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The file could not be read. Please upload it again." };
  const { kind, rows, mapping } = parsed.data;
  const summary: ImportSummary = { imported: 0, skippedDuplicates: 0, failed: [] };

  if (kind === "transactions") {
    const existing = await ctx.supabase
      .from("transactions")
      .select("import_fingerprint")
      .eq("business_id", ctx.business.id)
      .eq("status", "posted")
      .not("import_fingerprint", "is", null);
    if (existing.error) return { ok: false, error: dbErrorMessage(existing.error) };
    const fingerprints = new Set<string>(((existing.data ?? []) as { import_fingerprint: string }[]).map((r) => r.import_fingerprint));
    const result = validateTransactionRows(rows, mapping, fingerprints);
    summary.skippedDuplicates = result.duplicates.length;
    for (const e of result.errors) summary.failed.push({ row: e.row, message: e.message });
    for (const row of result.valid) {
      const err = await postTransactionRow(ctx, row);
      if (!err) summary.imported++;
      else if (err === "duplicate") summary.skippedDuplicates++;
      else summary.failed.push({ row: row.row, message: err });
    }
  } else {
    const existing = await ctx.supabase.from("products").select("name, sku").eq("business_id", ctx.business.id);
    if (existing.error) return { ok: false, error: dbErrorMessage(existing.error) };
    const existingProducts = (existing.data ?? []) as { name: string; sku: string | null }[];
    const names = new Set<string>(existingProducts.map((p) => p.name.toLowerCase().replace(/\s+/g, " ").trim()));
    const skus = new Set<string>(existingProducts.filter((p) => p.sku).map((p) => String(p.sku).toLowerCase().trim()));
    const result = validateProductRows(rows, mapping, { names, skus });
    summary.skippedDuplicates = result.duplicates.length;
    for (const e of result.errors) summary.failed.push({ row: e.row, message: e.message });
    for (const row of result.valid) {
      const err = await postProductRow(ctx, row);
      if (!err) summary.imported++;
      else summary.failed.push({ row: row.row, message: err });
    }
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Imported ${summary.imported} row${summary.imported === 1 ? "" : "s"}.`,
    data: summary,
  };
}

type Ctx = Awaited<ReturnType<typeof requireBusiness>>;

async function postTransactionRow(ctx: Ctx, row: ImportTransactionRow): Promise<string | null> {
  const key = crypto.randomUUID();
  const common = { p_business_id: ctx.business.id, p_idempotency_key: key, p_source: "import", p_import_fingerprint: row.fingerprint };
  const { error } =
    row.kind === "sale"
      ? await ctx.supabase.rpc("record_sale", {
          ...common,
          p_sale_kind: "cash",
          p_lines: [{ description: row.description, quantity: 1, unit_price_minor: row.amount }],
          p_txn_date: row.date,
          p_payment_method: row.payment_method,
          p_reference: row.reference ?? null,
        })
      : await ctx.supabase.rpc("record_expense", {
          ...common,
          p_category: row.category,
          p_amount_minor: row.amount,
          p_txn_date: row.date,
          p_description: row.description,
          p_payment_method: row.payment_method,
          p_reference: row.reference ?? null,
        });
  if (!error) return null;
  if (error.code === "23505") return "duplicate";
  return dbErrorMessage(error);
}

async function postProductRow(ctx: Ctx, row: ImportProductRow): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("products")
    .insert({
      business_id: ctx.business.id,
      name: row.name,
      sku: row.sku ?? null,
      selling_price_minor: row.selling_price,
      last_unit_cost_minor: row.unit_cost ?? 0,
      low_stock_threshold: row.low_stock_threshold,
      barcode: row.barcode ?? null,
    })
    .select("id")
    .single();
  if (error) return dbErrorMessage(error);
  if (row.quantity > 0) {
    const { error: stockError } = await ctx.supabase.rpc("record_opening_stock", {
      p_business_id: ctx.business.id,
      p_product_id: data.id,
      p_quantity: row.quantity,
      p_unit_cost_minor: row.unit_cost ?? 0,
      p_txn_date: ctx.today,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (stockError) return `Product added but opening stock failed: ${dbErrorMessage(stockError)}`;
  }
  return null;
}
