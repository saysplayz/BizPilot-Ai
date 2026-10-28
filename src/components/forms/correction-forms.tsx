// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { Ban, Pencil, RotateCcw } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { ActionForm, FormMessage, useIdempotencyKey } from "@/components/ui/form";
import { formatMoney } from "@/core/money";
import { editTransactionDetails, recordRefund, voidTransaction } from "@/lib/actions/transactions";
import { initialActionState } from "@/lib/errors";
import { PaymentFields, type AccountOption } from "./shared";

export function VoidButton({ transactionId, idempotencyKey, description }: { transactionId: string; idempotencyKey: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidTransaction, initialActionState);
  const key = useIdempotencyKey(idempotencyKey, state);
  useEffect(() => {
    if (state.ok && state.message) setOpen(false);
  }, [state]);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Ban className="size-4" aria-hidden /> Void
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Void this record?" description={description}>
        <ActionForm action={action} pending={pending} className="space-y-4">
          <input type="hidden" name="transaction_id" value={transactionId} />
          <input type="hidden" name="idempotency_key" value={key} />
          <p className="text-sm text-ink-soft">
            Voiding posts an exact reversal: cash, stock and balances go back to how they were. The original stays visible, marked as voided, with your reason. This cannot be undone — re-enter the correct record afterwards.
          </p>
          <FormMessage state={state} />
          <Field label="Reason" error={state.ok ? undefined : state.fieldErrors?.reason}>
            {(p) => <Textarea {...p} name="reason" required maxLength={500} placeholder="e.g. Entered twice by mistake" />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant="danger" pendingText="Voiding…">
              Void record
            </SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}

export function EditDetailsButton({ transactionId, description, reference, notes }: { transactionId: string; description: string; reference: string | null; notes: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(editTransactionDetails, initialActionState);
  useEffect(() => {
    if (state.ok && state.message) setOpen(false);
  }, [state]);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden /> Edit details
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit details" description="Amounts and dates can't be edited — void and re-enter instead, so the history stays accurate.">
        <ActionForm action={action} pending={pending} className="space-y-4">
          <input type="hidden" name="transaction_id" value={transactionId} />
          <FormMessage state={state} />
          <Field label="Description">{(p) => <Input {...p} name="description" defaultValue={description} required maxLength={200} />}</Field>
          <Field label="Reference" optional>
            {(p) => <Input {...p} name="reference" defaultValue={reference ?? ""} maxLength={80} />}
          </Field>
          <Field label="Notes" optional>
            {(p) => <Textarea {...p} name="notes" defaultValue={notes ?? ""} maxLength={1000} />}
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}

export function RefundButton({
  invoiceId,
  lines,
  accounts,
  today,
  idempotencyKey,
}: {
  invoiceId: string;
  lines: { id: string; description: string; quantity: number; refunded_quantity: number; unit_price_minor: number }[];
  accounts: AccountOption[];
  today: string;
  idempotencyKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordRefund, initialActionState);
  const key = useIdempotencyKey(idempotencyKey, state);
  const [qty, setQty] = useState<Record<string, string>>({});
  const refundable = lines.filter((l) => l.quantity > l.refunded_quantity);
  const payload = refundable
    .map((l) => ({ invoice_line_id: l.id, quantity: Number(qty[l.id] ?? 0) }))
    .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
  const total = payload.reduce((s, p) => s + p.quantity * (lines.find((l) => l.id === p.invoice_line_id)?.unit_price_minor ?? 0), 0);
  if (refundable.length === 0) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" aria-hidden /> Refund
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Refund items" description="If the customer still owes on this sale, the refund reduces what they owe first; the rest is paid back.">
        <ActionForm action={action} pending={pending} className="space-y-4">
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <input type="hidden" name="idempotency_key" value={key} />
          <input type="hidden" name="lines" value={JSON.stringify(payload)} />
          <input type="hidden" name="txn_date" value={today} />
          <FormMessage state={state} />
          {refundable.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3">
              <label htmlFor={`rq-${l.id}`} className="text-sm">
                {l.description} <span className="text-ink-muted">(up to {l.quantity - l.refunded_quantity})</span>
              </label>
              <Input
                id={`rq-${l.id}`}
                className="w-20"
                inputMode="numeric"
                value={qty[l.id] ?? ""}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  const n = Math.min(Number(v || 0), l.quantity - l.refunded_quantity);
                  setQty((q) => ({ ...q, [l.id]: v ? String(n) : "" }));
                }}
              />
            </div>
          ))}
          <p className="text-sm">
            Refund total: <strong className="tabular">{formatMoney(total)}</strong>
          </p>
          <Checkbox name="restock" defaultChecked label="Put the returned items back into stock" />
          <PaymentFields accounts={accounts} />
          <Field label="Reason">{(p) => <Input {...p} name="reason" required maxLength={500} placeholder="e.g. Faulty charger" />}</Field>
          <div className="flex justify-end">
            <SubmitButton disabled={payload.length === 0}>Record refund</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
