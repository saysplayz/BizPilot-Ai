// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { Metadata } from "next";
import { LoginForm } from "@/components/forms/auth-forms";
import { Notice } from "@/components/ui/feedback";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Welcome back</h1>
      <p className="mb-5 text-sm text-ink-muted">Log in to see how your business is doing.</p>
      {error === "auth" && (
        <Notice tone="danger" className="mb-4">
          That sign-in link is invalid or has expired. Please log in again.
        </Notice>
      )}
      <LoginForm next={next} />
    </>
  );
}
