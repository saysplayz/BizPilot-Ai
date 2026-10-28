// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ActionForm, FormMessage, fieldError } from "@/components/ui/form";
import { signIn, signUp } from "@/lib/actions/auth";
import { initialActionState } from "@/lib/errors";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, initialActionState);
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <FormMessage state={state} />
      <Field label="Email" error={fieldError(state, "email")}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Field label="Password" error={fieldError(state, "password")}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <SubmitButton className="w-full" pendingText="Signing in…">
        Log in
      </SubmitButton>
      <p className="text-center text-sm text-ink-muted">
        New to BizPilot?{" "}
        <Link href="/signup" className="font-medium text-brand hover:underline">
          Create an account
        </Link>
      </p>
    </ActionForm>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initialActionState);
  if (state.ok && state.message) {
    return (
      <div className="space-y-4">
        <FormMessage state={state} />
        <Link href="/login" className="block text-center text-sm font-medium text-brand hover:underline">
          Go to log in
        </Link>
      </div>
    );
  }
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="Your name" error={fieldError(state, "full_name")}>
        {(p) => <Input {...p} name="full_name" autoComplete="name" required />}
      </Field>
      <Field label="Email" error={fieldError(state, "email")}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </Field>
      <Field label="Password" hint="At least 8 characters, with a number" error={fieldError(state, "password")}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={8} />}
      </Field>
      <SubmitButton className="w-full" pendingText="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-center text-xs text-ink-muted">
        By continuing you agree to how we handle your data in our{" "}
        <Link href="/privacy" className="underline">
          privacy notice
        </Link>
        .
      </p>
      <p className="text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Log in
        </Link>
      </p>
    </ActionForm>
  );
}
