// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select } from "@/components/ui/field";
import { ActionForm, FormMessage, fieldError } from "@/components/ui/form";
import { createBusiness } from "@/lib/actions/business";
import { initialActionState } from "@/lib/errors";

const TYPES = [
  ["electronics", "Phones & electronics"],
  ["clothing", "Clothing & fashion"],
  ["cosmetics", "Cosmetics & beauty"],
  ["minimart", "Mini-mart / provisions"],
  ["wholesale", "Wholesale"],
  ["other", "Other shop"],
] as const;

export function BusinessSetupForm() {
  const [state, action, pending] = useActionState(createBusiness, initialActionState);
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="Business name" error={fieldError(state, "name")}>
        {(p) => <Input {...p} name="name" placeholder="e.g. Kofi's Phone Hub" required maxLength={120} />}
      </Field>
      <Field label="What do you sell?" error={fieldError(state, "business_type")}>
        {(p) => (
          <Select {...p} name="business_type" defaultValue="electronics">
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Currency" hint="BizPilot works in Ghana cedis for now.">
        {(p) => (
          <Select {...p} name="currency" defaultValue="GHS">
            <option value="GHS">Ghana cedi (GH₵)</option>
          </Select>
        )}
      </Field>
      <Field
        label="Cash you have today"
        optional
        hint="Money in your till and Mobile Money right now. Skip it and add it later in Settings — figures will be marked incomplete until you do."
        error={fieldError(state, "opening_cash")}
      >
        {(p) => <MoneyInput {...p} name="opening_cash" />}
      </Field>
      <Field label="Minimum cash to keep" optional hint="We'll warn you if your forecast drops below this safety buffer." error={fieldError(state, "min_cash_reserve")}>
        {(p) => <MoneyInput {...p} name="min_cash_reserve" />}
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Setting up…">
        Start using BizPilot
      </SubmitButton>
    </ActionForm>
  );
}
