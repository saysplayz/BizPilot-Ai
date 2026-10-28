// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-canvas p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-ink-muted">The page or record doesn&apos;t exist, or it belongs to a different business.</p>
      <Link href="/dashboard" className="mt-2 text-sm font-medium text-brand hover:underline">
        Go to dashboard
      </Link>
    </div>
  );
}
