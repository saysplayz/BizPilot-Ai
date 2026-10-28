// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { Metadata } from "next";
import { SignupForm } from "@/components/forms/auth-forms";
import { Notice } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create your account</h1>
      <p className="mb-5 text-sm text-ink-muted">It takes about five minutes to get your shop set up.</p>
      {demo && (
        <Notice tone="info" className="mb-4">
          After you create your account, choose <strong>Explore the demo shop</strong> on the next screen. The demo uses fictional data and is kept separate from
          your real business.
        </Notice>
      )}
      <SignupForm />
    </>
  );
}
