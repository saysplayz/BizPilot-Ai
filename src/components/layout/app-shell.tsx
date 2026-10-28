// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import {
  ArrowLeftRight,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Settings,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "@/lib/actions/auth";
import { switchBusiness } from "@/lib/actions/business";
import { cn } from "@/components/ui/cn";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/cash-flow", label: "Cash Flow", icon: TrendingUp },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const MOBILE_PRIMARY = ["/dashboard", "/transactions", "/cash-flow", "/assistant"];

interface ShellProps {
  children: ReactNode;
  business: { id: string; name: string; is_demo: boolean };
  businesses: { id: string; name: string; is_demo: boolean }[];
  userName: string | null;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BusinessSwitcher({ business, businesses }: Pick<ShellProps, "business" | "businesses">) {
  if (businesses.length <= 1) {
    return <p className="truncate text-sm font-semibold text-ink">{business.name}</p>;
  }
  return (
    <form action={switchBusiness}>
      <label className="sr-only" htmlFor="business-switcher">
        Switch business
      </label>
      <select
        id="business-switcher"
        name="business_id"
        defaultValue={business.id}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-full truncate rounded-md border border-line bg-surface px-2 py-1.5 text-sm font-semibold text-ink"
      >
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </form>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-brand-soft text-brand-strong" : "text-ink-soft hover:bg-canvas hover:text-ink",
              )}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({ children, business, businesses, userName }: ShellProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2 px-5 pb-3 pt-5">
          <Logo />
        </div>
        <div className="px-4 pb-3">
          <BusinessSwitcher business={business} businesses={businesses} />
          {business.is_demo && <p className="mt-1 text-xs font-medium text-warning">Demo business · fictional data</p>}
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
          <NavLinks pathname={pathname} />
        </nav>
        <div className="border-t border-line p-3">
          <Link href="/transactions/new" className="mb-2 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white hover:bg-brand-strong">
            <Plus className="size-4" aria-hidden /> Record
          </Link>
          <form action={signOut} className="flex items-center justify-between gap-2 px-1">
            <span className="truncate text-xs text-ink-muted">{userName ?? "Signed in"}</span>
            <button type="submit" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-canvas">
              <LogOut className="size-3.5" aria-hidden /> Log out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0">
          <Logo compact />
          <p className="truncate text-xs text-ink-muted">
            {business.name}
            {business.is_demo && <span className="font-medium text-warning"> · demo</span>}
          </p>
        </div>
        <Link href="/transactions/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white">
          <Plus className="size-4" aria-hidden /> Record
        </Link>
      </header>

      <main id="main" className="min-w-0 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto max-w-6xl animate-fade-in">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => MOBILE_PRIMARY.includes(n.href)).map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-brand" : "text-ink-muted")}>
                  <Icon className="size-5" aria-hidden />
                  {label === "AI Assistant" ? "Assistant" : label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setMoreOpen(true)} className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-ink-muted" aria-expanded={moreOpen} aria-controls="more-menu">
              <Menu className="size-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="more-menu">
          <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-pop)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="min-w-0 flex-1 pr-3">
                <BusinessSwitcher business={business} businesses={businesses} />
              </div>
              <button type="button" onClick={() => setMoreOpen(false)} className="rounded-md p-2 text-ink-soft hover:bg-canvas" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setMoreOpen(false)} />
            <form action={signOut} className="mt-3 border-t border-line pt-3">
              <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-canvas">
                <LogOut className="size-[18px]" aria-hidden /> Log out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="inline-flex items-center gap-2 font-semibold text-ink" aria-label="BizPilot AI home">
      <svg viewBox="0 0 32 32" className={compact ? "size-6" : "size-7"} aria-hidden>
        <rect width="32" height="32" rx="8" fill="#0f766e" />
        <path d="M8 21.5l5.5-5.5 4 4L24 13.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="13.5" r="2.2" fill="#fbbf24" />
      </svg>
      <span className={compact ? "text-[15px]" : "text-base"}>
        BizPilot <span className="text-brand">AI</span>
      </span>
    </Link>
  );
}
