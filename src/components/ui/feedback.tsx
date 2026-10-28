// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "positive" | "warning" | "danger" | "info" | "brand";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-soft border-line",
  positive: "bg-positive-soft text-positive border-emerald-200",
  warning: "bg-warning-soft text-warning border-amber-200",
  danger: "bg-danger-soft text-danger border-red-200",
  info: "bg-info-soft text-info border-blue-200",
  brand: "bg-brand-soft text-brand-strong border-teal-200",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", badgeTones[tone], className)}>{children}</span>;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  posted: { label: "Recorded", tone: "positive" },
  voided: { label: "Voided", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Unpaid", tone: "warning" },
  partially_paid: { label: "Part paid", tone: "info" },
  paid: { label: "Paid", tone: "positive" },
  void: { label: "Void", tone: "neutral" },
  overdue: { label: "Overdue", tone: "danger" },
  confirmed: { label: "Recorded", tone: "positive" },
  scheduled: { label: "Scheduled", tone: "info" },
  expected: { label: "Expected", tone: "brand" },
  uncertain: { label: "Uncertain", tone: "warning" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const noticeTones = {
  info: { cls: "border-blue-200 bg-info-soft text-info", Icon: Info },
  success: { cls: "border-emerald-200 bg-positive-soft text-positive", Icon: CheckCircle2 },
  warning: { cls: "border-amber-200 bg-warning-soft text-warning", Icon: AlertTriangle },
  danger: { cls: "border-red-200 bg-danger-soft text-danger", Icon: OctagonAlert },
};

/** Inline message. role=status for info/success, alert for warnings/errors. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof noticeTones;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = noticeTones[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-3.5 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-soft">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-line/70", className)} aria-hidden />;
}

export function LoadingPage({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
