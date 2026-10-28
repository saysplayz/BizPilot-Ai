// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BusinessSetupForm } from "@/components/forms/business-setup-form";
import { Logo } from "@/components/layout/app-shell";
import { SubmitButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { createDemoBusiness } from "@/lib/actions/business";
import { listBusinesses, requireUser } from "@/lib/context";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user } = await requireUser();
  const businesses = await listBusinesses();
  const { error } = await searchParams;

  return (
    <div className="min-h-dvh bg-canvas px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          {businesses.length > 0 && (
            <Link href="/dashboard" className="text-sm font-medium text-brand hover:underline">
              Back to dashboard
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {businesses.length > 0 ? "Add another business" : `Akwaaba${user.name ? `, ${user.name.split(" ")[0]}` : ""}!`}
        </h1>
        <p className="mb-6 mt-1 text-sm text-ink-muted">Just the essentials — you can change everything later.</p>

        {error === "demo" && (
          <Notice tone="danger" className="mb-4">
            The demo business could not be created. Please try again.
          </Notice>
        )}

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
          <BusinessSetupForm />
        </div>

        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-5 text-brand" aria-hidden />
            <div className="flex-1">
              <h2 className="font-semibold">Just looking around?</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Open a demo phone shop filled with <strong>fictional</strong> sales, stock, debts and bills. It is kept completely separate from your real business.
              </p>
              <form action={createDemoBusiness} className="mt-3">
                <SubmitButton variant="secondary" pendingText="Building demo…">
                  Explore the demo shop
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
