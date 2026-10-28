// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { createContext, useEffect, useState, useTransition, type ComponentProps } from "react";
import type { ActionResult } from "@/lib/errors";
import { Notice } from "./feedback";

/** Shows the result of a server action. */
export function FormMessage({ state }: { state: ActionResult<unknown> }) {
  if (state.ok && state.message) return <Notice tone="success">{state.message}</Notice>;
  if (!state.ok) return <Notice tone="danger">{state.error}</Notice>;
  return null;
}

export function fieldError(state: ActionResult<unknown>, name: string): string | undefined {
  return state.ok ? undefined : state.fieldErrors?.[name];
}

/**
 * Idempotency key for a form submission. The server renders the first key;
 * after a successful save a fresh key is generated so the next submission is
 * a new record, while retries of a failed/duplicated submit reuse the key and
 * can never post twice.
 */
export function useIdempotencyKey(initial: string, state: ActionResult<unknown>) {
  const [key, setKey] = useState(initial);
  useEffect(() => {
    if (state.ok && state.message) setKey(crypto.randomUUID());
  }, [state]);
  return key;
}

/** Pending state for submit buttons inside an ActionForm. */
export const FormPendingContext = createContext<boolean | null>(null);

/**
 * Form that submits to a server action WITHOUT React 19's automatic reset of
 * uncontrolled fields, so a validation error never wipes what the owner typed.
 * The clicked submit button's name/value is included (e.g. "post" vs "draft").
 */
export function ActionForm({
  action,
  pending,
  children,
  ...props
}: Omit<ComponentProps<"form">, "action" | "onSubmit"> & { action: (formData: FormData) => void; pending: boolean }) {
  const [, startTransition] = useTransition();
  return (
    <FormPendingContext value={pending}>
      <form
        {...props}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const data = new FormData(e.currentTarget, submitter);
          startTransition(() => action(data));
        }}
      >
        {children}
      </form>
    </FormPendingContext>
  );
}
