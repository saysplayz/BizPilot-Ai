// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { Copy, MessageCircle, Send } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/field";
import { ActionForm, FormMessage } from "@/components/ui/form";
import { toInputValue } from "@/core/money";
import { buildReminderMessage, smsLink, whatsappLink, type ReminderTone } from "@/core/reminders";
import { saveCustomer, saveSupplier } from "@/lib/actions/records";
import { initialActionState } from "@/lib/errors";

export function CustomerForm({
  customer,
  returnTo,
}: {
  customer?: { id: string; name: string; phone: string | null; notes: string | null; credit_limit_minor: number | null; payment_terms_days: number | null };
  returnTo?: string;
}) {
  const [state, action, pending] = useActionState(saveCustomer, initialActionState);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      {customer && <input type="hidden" name="id" value={customer.id} />}
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <FormMessage state={state} />
      <Field label="Name" error={errors.name}>
        {(p) => <Input {...p} name="name" defaultValue={customer?.name} required maxLength={120} />}
      </Field>
      <Field label="Phone" optional hint="Used only for reminders you send yourself" error={errors.phone}>
        {(p) => <Input {...p} name="phone" type="tel" defaultValue={customer?.phone ?? ""} placeholder="024 555 0101" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Credit limit" optional hint="Sales on credit above this are refused" error={errors.credit_limit}>
          {(p) => <MoneyInput {...p} name="credit_limit" defaultValue={customer?.credit_limit_minor ? toInputValue(customer.credit_limit_minor) : ""} />}
        </Field>
        <Field label="Usually pays within (days)" optional error={errors.payment_terms_days}>
          {(p) => <Input {...p} name="payment_terms_days" inputMode="numeric" defaultValue={customer?.payment_terms_days?.toString() ?? ""} placeholder="7" />}
        </Field>
      </div>
      <Field label="Notes" optional>
        {(p) => <Textarea {...p} name="notes" defaultValue={customer?.notes ?? ""} maxLength={1000} />}
      </Field>
      <SubmitButton>{customer ? "Save changes" : "Add customer"}</SubmitButton>
    </ActionForm>
  );
}

export function SupplierForm({
  supplier,
}: {
  supplier?: { id: string; name: string; phone: string | null; email: string | null; notes: string | null; payment_terms_days: number | null };
}) {
  const [state, action, pending] = useActionState(saveSupplier, initialActionState);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <FormMessage state={state} />
      <Field label="Name" error={errors.name}>
        {(p) => <Input {...p} name="name" defaultValue={supplier?.name} required maxLength={120} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" optional error={errors.phone}>
          {(p) => <Input {...p} name="phone" type="tel" defaultValue={supplier?.phone ?? ""} />}
        </Field>
        <Field label="Email" optional error={errors.email}>
          {(p) => <Input {...p} name="email" type="email" defaultValue={supplier?.email ?? ""} />}
        </Field>
      </div>
      <Field label="Payment terms (days)" optional hint="Used as the default due date for bills" error={errors.payment_terms_days}>
        {(p) => <Input {...p} name="payment_terms_days" inputMode="numeric" defaultValue={supplier?.payment_terms_days?.toString() ?? ""} placeholder="14" />}
      </Field>
      <Field label="Notes" optional>
        {(p) => <Textarea {...p} name="notes" defaultValue={supplier?.notes ?? ""} maxLength={1000} />}
      </Field>
      <SubmitButton>{supplier ? "Save changes" : "Add supplier"}</SubmitButton>
    </ActionForm>
  );
}

/**
 * Reminder composer. The owner reviews the text and sends it from their own
 * phone (WhatsApp/SMS link or copy). BizPilot never sends messages itself.
 */
export function ReminderButton({
  businessName,
  customerName,
  phone,
  amount,
  dueDate,
  daysOverdue,
  invoiceNumber,
}: {
  businessName: string;
  customerName: string;
  phone: string | null;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  invoiceNumber?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<ReminderTone>(daysOverdue > 14 ? "firm" : "friendly");
  const generated = useMemo(
    () => buildReminderMessage({ businessName, customerName, amount, dueDate, daysOverdue, invoiceNumber, tone }),
    [businessName, customerName, amount, dueDate, daysOverdue, invoiceNumber, tone],
  );
  const [text, setText] = useState<string | null>(null);
  const message = text ?? generated;
  const wa = phone ? whatsappLink(phone, message) : null;
  const [copied, setCopied] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <MessageCircle className="size-4" aria-hidden /> Reminder
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Reminder for ${customerName}`} description="Review and edit the message, then send it yourself. BizPilot does not send messages.">
        <div className="space-y-3">
          <Field label="Tone">
            {(p) => (
              <Select
                {...p}
                value={tone}
                onChange={(e) => {
                  setTone(e.target.value as ReminderTone);
                  setText(null);
                }}
              >
                <option value="friendly">Friendly</option>
                <option value="firm">Firm</option>
              </Select>
            )}
          </Field>
          <Field label="Message">{(p) => <Textarea {...p} value={message} onChange={(e) => setText(e.target.value)} className="min-h-40" />}</Field>
          <div className="flex flex-wrap gap-2">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong">
                <Send className="size-4" aria-hidden /> Open in WhatsApp
              </a>
            )}
            {phone && (
              <a href={smsLink(phone, message)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong px-4 text-sm font-medium">
                SMS
              </a>
            )}
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(message);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <Copy className="size-4" aria-hidden /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {!phone && <p className="text-xs text-ink-muted">Add a phone number to this customer to open WhatsApp or SMS directly.</p>}
        </div>
      </Dialog>
    </>
  );
}
