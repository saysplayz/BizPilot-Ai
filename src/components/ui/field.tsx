// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-ink-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-11 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

/** Money input: numeric keyboard on phones, GH₵ prefix, plain decimal text submitted. */
export function MoneyInput({ className, currency = "GH₵", ...props }: ComponentProps<"input"> & { currency?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted">{currency}</span>
      <input inputMode="decimal" autoComplete="off" placeholder="0.00" className={cn(control, "tabular h-11 pl-12", className)} {...props} />
    </div>
  );
}

/**
 * Label + control + hint + error, wired up for screen readers.
 * `children` receives the generated id and aria props.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label} {optional && <span className="font-normal text-ink-muted">(optional)</span>}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-sm text-ink", className)}>
      <input type="checkbox" className="mt-0.5 size-4 rounded border-line-strong accent-brand" {...props} />
      <span>{label}</span>
    </label>
  );
}
