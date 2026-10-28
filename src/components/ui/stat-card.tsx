// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney, type Minor } from "@/core/money";
import { cn } from "./cn";

/**
 * Financial summary card. `plainLabel` is the everyday wording owners see;
 * `term` is the accounting term in small print, so the app teaches without
 * requiring accounting knowledge.
 */
export function StatCard({
  plainLabel,
  term,
  value,
  currency = "GHS",
  hint,
  tone = "neutral",
  estimate,
  href,
  icon,
}: {
  plainLabel: string;
  term?: string;
  value: Minor | null;
  currency?: string;
  hint?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "danger";
  estimate?: boolean;
  href?: string;
  icon?: ReactNode;
}) {
  const valueColor = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "positive" ? "text-positive" : "text-ink";
  const body = (
    <div className="flex h-full flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug text-ink-soft">{plainLabel}</p>
        {icon && <span className="text-ink-muted" aria-hidden>{icon}</span>}
      </div>
      <p className={cn("tabular text-xl font-semibold tracking-tight sm:text-2xl", valueColor)}>
        {value === null ? <span className="text-ink-muted">—</span> : formatMoney(value, { currency })}
        {estimate && value !== null && <span className="ml-1.5 align-middle text-[11px] font-medium text-warning">est.</span>}
      </p>
      <div className="mt-auto space-y-0.5">
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
        {term && <p className="text-[11px] uppercase tracking-wide text-ink-muted/80">{term}</p>}
      </div>
    </div>
  );
  const cls = "block rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-line-strong hover:bg-white/60")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
