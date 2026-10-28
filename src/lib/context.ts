// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { todayIn, type IsoDate } from "@/core/dates";
import type { BusinessType } from "@/core/finance/types";
import { createSupabaseServerClient, type SupabaseServerClient } from "@/lib/supabase/server";

export const ACTIVE_BUSINESS_COOKIE = "bp_business_id";

export interface BusinessSummary {
  id: string;
  name: string;
  business_type: BusinessType;
  currency: string;
  timezone: string;
  min_cash_reserve_minor: number | null;
  opening_balance_set_at: string | null;
  is_demo: boolean;
  role: "owner" | "manager" | "staff";
}

export interface AppContext {
  supabase: SupabaseServerClient;
  user: { id: string; email: string | null; name: string | null };
  business: BusinessSummary;
  businesses: BusinessSummary[];
  today: IsoDate;
}

/** The signed-in user, or a redirect to login. Cached per request. */
export const requireUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return {
    supabase,
    user: {
      id: user.id,
      email: user.email ?? null,
      name: (user.user_metadata?.full_name as string | undefined) ?? null,
    },
  };
});

/** Businesses the user belongs to (RLS-filtered). */
export const listBusinesses = cache(async (): Promise<BusinessSummary[]> => {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("business_memberships")
    .select("role, businesses(id, name, business_type, currency, timezone, min_cash_reserve_minor, opening_balance_set_at, is_demo)")
    .eq("user_id", user.id);
  if (error) throw new Error(`Could not load businesses: ${error.message}`);
  type Row = { role: BusinessSummary["role"]; businesses: Omit<BusinessSummary, "role"> | Omit<BusinessSummary, "role">[] | null };
  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const b = Array.isArray(r.businesses) ? r.businesses[0] : r.businesses;
      return b ? { ...b, role: r.role } : null;
    })
    .filter((b): b is BusinessSummary => b !== null)
    .sort((a, b) => Number(a.is_demo) - Number(b.is_demo) || a.name.localeCompare(b.name));
});

/**
 * Full app context: user + active business. Redirects to onboarding when the
 * user has no business yet. The active business is remembered in a cookie
 * but always re-validated against the user's memberships.
 */
export const requireBusiness = cache(async (): Promise<AppContext> => {
  const { supabase, user } = await requireUser();
  const businesses = await listBusinesses();
  if (businesses.length === 0) redirect("/onboarding");
  const cookieStore = await cookies();
  const wanted = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;
  const business = businesses.find((b) => b.id === wanted) ?? businesses.find((b) => !b.is_demo) ?? businesses[0]!;
  return { supabase, user, business, businesses, today: todayIn(business.timezone) };
});

export function canManage(business: BusinessSummary): boolean {
  return business.role === "owner" || business.role === "manager";
}
