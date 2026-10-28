// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm, FormMessage, fieldError, useIdempotencyKey } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { addDays } from "@/core/dates";
import { recordSale } from "@/lib/actions/transactions";
import { initialActionState } from "@/lib/errors";
import { LineItems, PaymentFields, type AccountOption, type Option, type ProductOption } from "./shared";

export function SaleForm({
  products,
  customers,
  accounts,
  today,
  idempotencyKey,
  prefill,
}: {
  products: ProductOption[];
  customers: Option[];
  accounts: AccountOption[];
  today: string;
  idempotencyKey: string;
  prefill?: { description?: string; amount?: string; date?: string; source?: string };
}) {
  const [state, action, pending] = useActionState(recordSale, initialActionState);
  const key = useIdempotencyKey(idempotencyKey, state);
  const [kind, setKind] = useState<"cash" | "credit">("cash");
  const errors = state.ok ? {} : (state.fieldErrors ?? {});

  return (
    <ActionForm action={action} pending={pending} className="space-y-5" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <input type="hidden" name="sale_kind" value={kind} />
      {prefill?.source && <input type="hidden" name="source" value={prefill.source} />}
      <FormMessage state={state} />

      <div role="radiogroup" aria-label="Has the customer paid?" className="grid grid-cols-2 gap-2">
        {(
          [
            ["cash", "Paid now", "Money received today"],
            ["credit", "Pay later", "Customer owes you"],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => setKind(value)}
            className={cn("rounded-lg border p-3 text-left transition-colors", kind === value ? "border-brand bg-brand-soft" : "border-line-strong bg-surface hover:bg-canvas")}
          >
            <span className="block text-sm font-semibold">{label}</span>
            <span className="block text-xs text-ink-muted">{hint}</span>
          </button>
        ))}
      </div>

      <LineItems
        products={products}
        mode="sale"
        error={errors.lines}
        initial={prefill?.description ? [{ description: prefill.description, price: prefill.amount ?? "", quantity: "1" }] : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sale date" error={errors.txn_date}>
          {(p) => <Input {...p} type="date" name="txn_date" defaultValue={prefill?.date ?? today} max={addDays(today, 1)} required />}
        </Field>
        <Field label="Customer" optional={kind === "cash"} error={errors.customer_id} hint={<Link href="/customers/new?return_to=/transactions/new?type=sale" className="text-brand hover:underline">+ New customer</Link>}>
          {(p) => (
            <Select {...p} name="customer_id" defaultValue="" required={kind === "credit"}>
              <option value="">{kind === "credit" ? "Choose who owes you" : "Walk-in customer"}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {kind === "credit" ? (
        <Field label="When will they pay?" optional hint="Leave empty to use the customer's usual terms (or 7 days)." error={errors.due_date}>
          {(p) => <Input {...p} type="date" name="due_date" min={today} defaultValue={addDays(today, 7)} />}
        </Field>
      ) : (
        <PaymentFields accounts={accounts} errors={errors} />
      )}

      <details className="rounded-lg border border-line px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-ink-soft">More details</summary>
        <div className="mt-3 space-y-4">
          <Field label="Reference" optional hint="Receipt or MoMo transaction ID">
            {(p) => <Input {...p} name="reference" maxLength={80} />}
          </Field>
          <Field label="Notes" optional>
            {(p) => <Textarea {...p} name="notes" maxLength={1000} />}
          </Field>
        </div>
      </details>

      <SubmitButton size="lg" className="w-full sm:w-auto">
        {kind === "cash" ? "Record paid sale" : "Record sale on credit"}
      </SubmitButton>
      {fieldError(state, "_form") && <p className="text-sm text-danger">{fieldError(state, "_form")}</p>}
    </ActionForm>
  );
}
