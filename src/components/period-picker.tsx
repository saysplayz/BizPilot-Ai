// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import Link from "next/link";
import { cn } from "@/components/ui/cn";

const OPTIONS = [
  ["today", "Today"],
  ["this_week", "This week"],
  ["this_month", "This month"],
  ["last_month", "Last month"],
] as const;

/** Period filter as plain links (works without JavaScript, shareable URLs). */
export function PeriodPicker({ active, basePath, extra = {} }: { active: string; basePath: string; extra?: Record<string, string> }) {
  return (
    <nav aria-label="Period" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {OPTIONS.map(([value, label]) => {
        const params = new URLSearchParams({ ...extra, period: value });
        return (
          <Link
            key={value}
            href={`${basePath}?${params.toString()}`}
            aria-current={active === value ? "true" : undefined}
            className={cn("rounded-md px-2.5 py-1.5 text-xs font-medium sm:text-sm", active === value ? "bg-brand-soft text-brand-strong" : "text-ink-soft hover:text-ink")}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
