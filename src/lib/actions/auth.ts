// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInSchema, signUpSchema } from "@/core/validation/forms";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/context";
import { publicEnv, supabaseConfigProblem } from "@/lib/env";
import { formToObject, fromZodError, type ActionResult } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Only allow same-site relative redirects after login (prevents open redirects). */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/dashboard";
  return value;
}

const NOT_CONFIGURED: ActionResult = {
  ok: false,
  error: "Sign-in isn't set up yet: this installation is not connected to a Supabase project. Add your Supabase URL and anon key to .env.local and restart the server.",
};

const UNREACHABLE: ActionResult = {
  ok: false,
  error: "BizPilot couldn't reach the sign-in service. Check your internet connection and the Supabase URL in .env.local, then try again.",
};

interface AuthErrorLike {
  message: string;
  status?: number;
  name?: string;
  code?: string;
}

/** Supabase reports network failures as AuthRetryableFetchError / status 0 rather than throwing. */
function isNetworkError(error: AuthErrorLike): boolean {
  return error.name === "AuthRetryableFetchError" || error.status === 0 || /fetch failed|failed to fetch|network|ENOTFOUND|ECONNREFUSED/i.test(error.message);
}

export async function signIn(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (supabaseConfigProblem()) return NOT_CONFIGURED;
  const raw = formToObject(formData);
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return fromZodError(parsed.error);

  let error: AuthErrorLike | null;
  try {
    const supabase = await createSupabaseServerClient();
    ({ error } = await supabase.auth.signInWithPassword(parsed.data));
  } catch (err) {
    console.error("[auth.signIn]", err);
    return UNREACHABLE;
  }
  if (error) {
    if (isNetworkError(error)) {
      console.error("[auth.signIn] network", error.message);
      return UNREACHABLE;
    }
    if (error.code === "email_not_confirmed" || /not confirmed|confirm your email/i.test(error.message)) {
      return { ok: false, error: "Please confirm your email first — check your inbox for the link, then log in." };
    }
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { ok: false, error: "Too many attempts. Please wait a minute and try again." };
    }
    // Same message for unknown email and wrong password (no account enumeration).
    return { ok: false, error: "Email or password is incorrect." };
  }
  redirect(safeNext(raw.next));
}

export async function signUp(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (supabaseConfigProblem()) return NOT_CONFIGURED;
  const parsed = signUpSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  let result: { data: { session: unknown | null }; error: AuthErrorLike | null };
  try {
    const supabase = await createSupabaseServerClient();
    const origin = (await headers()).get("origin") ?? publicEnv().NEXT_PUBLIC_SITE_URL;
    result = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.full_name },
        emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
      },
    });
  } catch (err) {
    console.error("[auth.signUp]", err);
    return UNREACHABLE;
  }

  const { data, error } = result;
  if (error) {
    if (isNetworkError(error)) {
      console.error("[auth.signUp] network", error.message);
      return UNREACHABLE;
    }
    if (error.code === "user_already_exists" || /already registered|already exists/i.test(error.message)) {
      return { ok: false, error: "An account with this email already exists. Try logging in." };
    }
    if (error.code === "weak_password" || /password/i.test(error.message)) {
      return { ok: false, error: error.message, fieldErrors: { password: error.message } };
    }
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      return {
        ok: false,
        error: "Too many sign-ups in a short time (Supabase's email limit). Wait a little, or turn off \"Confirm email\" in Supabase while testing.",
      };
    }
    if (/database error/i.test(error.message)) {
      console.error("[auth.signUp] database", error.message);
      return { ok: false, error: "Your account couldn't be saved. Check that all BizPilot database migrations have been run in Supabase." };
    }
    console.error("[auth.signUp]", error.code, error.message);
    return { ok: false, error: "We couldn't create your account. Please try again." };
  }
  // With email confirmation on, there is no session yet.
  if (!data.session) {
    return { ok: true, message: "Check your email for a link to confirm your account, then log in." };
  }
  redirect("/onboarding");
}

export async function signOut(): Promise<void> {
  if (!supabaseConfigProblem()) {
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[auth.signOut]", err); // still clear local state and leave
    }
  }
  (await cookies()).delete(ACTIVE_BUSINESS_COOKIE);
  redirect("/login");
}
