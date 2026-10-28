// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useContext, type ComponentProps, type ReactNode } from "react";
import { FormPendingContext } from "./form";

import { buttonClass, type ButtonSize as Size, type ButtonVariant as Variant } from "./button-styles";

// Re-exported for Client Components; Server Components must import it from "./button-styles".
export { buttonClass };

export function Button({ variant = "primary", size = "md", className, ...props }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ variant = "primary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** Submit button that disables itself and shows progress while the form's server action runs. */
export function SubmitButton({ children, pendingText = "Saving…", ...props }: ComponentProps<typeof Button> & { pendingText?: ReactNode }) {
  const status = useFormStatus();
  const ctxPending = useContext(FormPendingContext);
  const pending = ctxPending ?? status.pending;
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending} {...props}>
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {pendingText}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
