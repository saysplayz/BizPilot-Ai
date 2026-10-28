// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select } from "@/components/ui/field";
import { ActionForm, FormMessage } from "@/components/ui/form";
import { saveScheduledEvent } from "@/lib/actions/records";
import { initialActionState } from "@/lib/errors";

/** Add a planned payment (rent, wages, loan repayment) or planned income to the forecast. */
export function ScheduledEventForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(saveScheduledEvent, initialActionState);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.message) ref.current?.reset();
  }, [state]);
  return (
    <ActionForm ref={ref} action={action} pending={pending} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.label}>
          {(p) => <Input {...p} name="label" placeholder="e.g. Shop rent, Assistant wage" required maxLength={120} />}
        </Field>
        <Field label="Amount" error={errors.amount}>
          {(p) => <MoneyInput {...p} name="amount" required />}
        </Field>
        <Field label="Money">
          {(p) => (
            <Select {...p} name="direction" defaultValue="out">
              <option value="out">I will pay</option>
              <option value="in">I will receive</option>
            </Select>
          )}
        </Field>
        <Field label="Category" optional>
          {(p) => (
            <Select {...p} name="category" defaultValue="Rent">
              <option>Rent</option>
              <option>Wages</option>
              <option>Utilities</option>
              <option>Loan repayment</option>
              <option>Taxes & levies</option>
              <option>Other</option>
            </Select>
          )}
        </Field>
        <Field label="First date" error={errors.start_date}>
          {(p) => <Input {...p} type="date" name="start_date" defaultValue={today} required />}
        </Field>
        <Field label="Repeats">
          {(p) => (
            <Select {...p} name="recurrence" defaultValue="monthly">
              <option value="none">Just once</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </Select>
          )}
        </Field>
        <Field label="How sure are you?" hint="Uncertain items are left out of the main forecast">
          {(p) => (
            <Select {...p} name="confidence" defaultValue="scheduled">
              <option value="scheduled">Committed (will happen)</option>
              <option value="expected">Expected</option>
              <option value="uncertain">Uncertain</option>
            </Select>
          )}
        </Field>
        <Field label="Until" optional error={errors.end_date}>
          {(p) => <Input {...p} type="date" name="end_date" />}
        </Field>
      </div>
      <SubmitButton variant="secondary">Add to forecast</SubmitButton>
    </ActionForm>
  );
}
