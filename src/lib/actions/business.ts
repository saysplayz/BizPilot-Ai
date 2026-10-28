// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { businessSettingsSchema, businessSetupSchema, openingBalanceSchema } from "@/core/validation/forms";
import { ACTIVE_BUSINESS_COOKIE, canManage, listBusinesses, requireBusiness, requireUser } from "@/lib/context";
import { formToObject, fromDbError, fromZodError, type ActionResult } from "@/lib/errors";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

async function setActiveBusiness(id: string) {
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, id, COOKIE_OPTS);
}

export async function createBusiness(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = businessSetupSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_business", {
    p_name: parsed.data.name,
    p_business_type: parsed.data.business_type,
    p_currency: parsed.data.currency,
    p_opening_cash_minor: parsed.data.opening_cash,
    p_min_cash_reserve_minor: parsed.data.min_cash_reserve,
  });
  if (error) return fromDbError(error);
  await setActiveBusiness(data as string);
  redirect("/dashboard?welcome=1");
}

export async function createDemoBusiness(): Promise<void> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_demo_business");
  if (error) {
    console.error("[demo]", error.code, error.message);
    redirect("/onboarding?error=demo");
  }
  await setActiveBusiness(data as string);
  redirect("/dashboard?demo=1");
}

export async function switchBusiness(formData: FormData): Promise<void> {
  const id = z.string().uuid().safeParse(formData.get("business_id"));
  if (!id.success) return;
  const businesses = await listBusinesses();
  if (!businesses.some((b) => b.id === id.data)) return; // never trust the client
  await setActiveBusiness(id.data);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function updateBusinessSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  if (!canManage(ctx.business)) return { ok: false, error: "Only the owner or a manager can change business settings." };
  const parsed = businessSettingsSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { error } = await ctx.supabase
    .from("businesses")
    .update({ name: parsed.data.name, business_type: parsed.data.business_type, min_cash_reserve_minor: parsed.data.min_cash_reserve })
    .eq("id", ctx.business.id);
  if (error) return fromDbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
}

export async function recordOpeningBalance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = openingBalanceSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { error } = await ctx.supabase.rpc("record_opening_balance", {
    p_business_id: ctx.business.id,
    p_financial_account_id: parsed.data.financial_account_id,
    p_amount_minor: parsed.data.amount,
    p_txn_date: parsed.data.txn_date,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return fromDbError(error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Opening balance recorded." };
}

const accountSchema = z.object({
  name: z.string().trim().min(1, "Name the account").max(60),
  kind: z.enum(["cash", "mobile_money", "bank"]),
});

export async function addMoneyAccount(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireBusiness();
  const parsed = accountSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { error } = await ctx.supabase.from("financial_accounts").insert({ business_id: ctx.business.id, ...parsed.data });
  if (error) return fromDbError(error.code === "23505" ? { ...error, code: "P0001", message: "You already have an account with that name." } : error);
  revalidatePath("/settings");
  return { ok: true, message: "Account added." };
}
