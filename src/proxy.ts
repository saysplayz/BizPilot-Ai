// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigProblem } from "@/lib/env";

/**
 * Next.js 16 proxy (formerly "middleware"): refreshes the Supabase session on
 * every request and redirects signed-out visitors away from app pages.
 * Authorisation itself is enforced by the database (RLS) — this is only UX.
 */
const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth", "/privacy"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  // Not connected to Supabase yet: public pages work, everything else goes to
  // /login, which shows the setup steps instead of failing.
  if (supabaseConfigProblem()) {
    if (isPublic(pathname) || pathname.startsWith("/api/")) return response;
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!.trim();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() verifies the JWT with Supabase Auth (do not trust getSession() on the server).
  let user: unknown = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (err) {
    console.error("[proxy] could not reach Supabase Auth", err);
  }
  if (!user && !isPublic(pathname) && !pathname.startsWith("/api/")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/dashboard";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
