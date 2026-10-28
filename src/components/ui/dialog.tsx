// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";

/**
 * Accessible modal built on the native <dialog> element (focus trapping,
 * Escape to close and inert background come from the browser).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] animate-fade-in rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]"
      aria-labelledby="dialog-title"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="dialog-title" className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
