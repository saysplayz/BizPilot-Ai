// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/app-shell";
import { supabaseConfigProblem } from "@/lib/env";

/**
 * Login / sign-up shell. If the server isn't connected to Supabase yet, show
 * setup steps instead of a form that can only fail.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const problem = supabaseConfigProblem();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
        {problem ? <SetupRequired problem={problem} /> : children}
      </div>
    </div>
  );
}

function SetupRequired({ problem }: { problem: string }) {
  return (
    <div className="space-y-3 text-sm text-ink-soft">
      <h1 className="text-lg font-semibold text-ink">Connect a database to sign in</h1>
      <p className="rounded-lg border border-amber-200 bg-warning-soft px-3 py-2 text-warning" role="alert">
        {problem}
      </p>
      <p>Accounts and business records are stored in Supabase. To finish setup:</p>
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          Create a free project at <span className="font-medium text-ink">supabase.com</span> and run the SQL files in <code className="text-xs">supabase/migrations</code>, in order, in the SQL Editor.
        </li>
        <li>
          From <span className="font-medium text-ink">Project Settings → API</span>, copy the Project URL and the anon/publishable key into <code className="text-xs">.env.local</code>.
        </li>
        <li>
          Stop the server (<kbd className="text-xs">Ctrl+C</kbd>), run <code className="text-xs">npm run dev</code> again and reload this page.
        </li>
      </ol>
      <p className="text-xs text-ink-muted">Full steps are in README.md → Supabase setup.</p>
    </div>
  );
}
