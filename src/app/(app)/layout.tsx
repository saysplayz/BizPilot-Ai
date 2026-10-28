// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireBusiness } from "@/lib/context";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireBusiness();
  return (
    <AppShell
      business={{ id: ctx.business.id, name: ctx.business.name, is_demo: ctx.business.is_demo }}
      businesses={ctx.businesses.map((b) => ({ id: b.id, name: b.name, is_demo: b.is_demo }))}
      userName={ctx.user.name ?? ctx.user.email}
    >
      {ctx.business.is_demo && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-warning-soft px-3.5 py-2.5 text-sm text-warning" role="note">
          <strong>Demo business.</strong> Everything here is fictional sample data for Kofi&apos;s Phone Hub. Your real business data is kept separately.
        </div>
      )}
      {children}
    </AppShell>
  );
}
