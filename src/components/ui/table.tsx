// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** Responsive table: scrolls horizontally on small screens instead of squashing. */
export function Table({ className, children, caption }: { className?: string; children: ReactNode; caption?: string }) {
  return (
    <div className="-mx-px overflow-x-auto">
      <table className={cn("w-full min-w-[560px] border-collapse text-sm", className)}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ className, align = "left", ...props }: ComponentProps<"th"> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn("border-b border-line bg-canvas/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted", align === "right" ? "text-right" : "text-left", className)}
      {...props}
    />
  );
}

export function Td({ className, align = "left", ...props }: ComponentProps<"td"> & { align?: "left" | "right" }) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle text-ink", align === "right" && "text-right tabular", className)} {...props} />;
}

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return null;
  const item = "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-line bg-surface px-3 text-sm";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-4 py-3">
      <p className="text-sm text-ink-muted">
        Page {page} of {pages}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={item} href={hrefFor(page - 1)} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={cn(item, "opacity-50")} aria-disabled>
            Previous
          </span>
        )}
        {page < pages ? (
          <Link className={item} href={hrefFor(page + 1)} rel="next">
            Next
          </Link>
        ) : (
          <span className={cn(item, "opacity-50")} aria-disabled>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
