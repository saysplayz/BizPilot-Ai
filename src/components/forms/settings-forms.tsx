// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select } from "@/components/ui/field";
import { ActionForm, FormMessage, useIdempotencyKey } from "@/components/ui/form";
import { toInputValue } from "@/core/money";
import { addMoneyAccount, recordOpeningBalance, updateBusinessSettings } from "@/lib/actions/business";
import { initialActionState } from "@/lib/errors";

export function BusinessSettingsForm({ business }: { business: { name: string; business_type: string; min_cash_reserve_minor: number | null } }) {
  const [state, action, pending] = useActionState(updateBusinessSettings, initialActionState);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field label="Business name" error={errors.name}>
        {(p) => <Input {...p} name="name" defaultValue={business.name} required maxLength={120} />}
      </Field>
      <Field label="Business type">
        {(p) => (
          <Select {...p} name="business_type" defaultValue={business.business_type}>
            <option value="electronics">Phones & electronics</option>
            <option value="clothing">Clothing & fashion</option>
            <option value="cosmetics">Cosmetics & beauty</option>
            <option value="minimart">Mini-mart / provisions</option>
            <option value="wholesale">Wholesale</option>
            <option value="other">Other</option>
          </Select>
        )}
      </Field>
      <Field label="Minimum cash to keep" optional hint="Forecast warns you before cash dips below this" error={errors.min_cash_reserve}>
        {(p) => <MoneyInput {...p} name="min_cash_reserve" defaultValue={business.min_cash_reserve_minor !== null ? toInputValue(business.min_cash_reserve_minor) : ""} />}
      </Field>
      <SubmitButton>Save settings</SubmitButton>
    </ActionForm>
  );
}

export function OpeningBalanceForm({ accounts, today, idempotencyKey }: { accounts: { id: string; name: string }[]; today: string; idempotencyKey: string }) {
  const [state, action, pending] = useActionState(recordOpeningBalance, initialActionState);
  const key = useIdempotencyKey(idempotencyKey, state);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Account">
          {(p) => (
            <Select {...p} name="financial_account_id">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Amount on that day" error={errors.amount}>
          {(p) => <MoneyInput {...p} name="amount" required />}
        </Field>
        <Field label="As of" error={errors.txn_date}>
          {(p) => <Input {...p} type="date" name="txn_date" defaultValue={today} max={today} required />}
        </Field>
      </div>
      <SubmitButton variant="secondary">Record opening balance</SubmitButton>
    </ActionForm>
  );
}

export function AddAccountForm() {
  const [state, action, pending] = useActionState(addMoneyAccount, initialActionState);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <ActionForm action={action} pending={pending} className="space-y-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account name" error={errors.name}>
          {(p) => <Input {...p} name="name" placeholder="e.g. GCB Bank, MTN MoMo 2" required maxLength={60} />}
        </Field>
        <Field label="Type">
          {(p) => (
            <Select {...p} name="kind" defaultValue="bank">
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="bank">Bank</option>
            </Select>
          )}
        </Field>
      </div>
      <SubmitButton variant="secondary">Add account</SubmitButton>
    </ActionForm>
  );
}
