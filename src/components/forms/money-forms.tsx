// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/field";
import { ActionForm, FormMessage, useIdempotencyKey } from "@/components/ui/form";
import { Notice } from "@/components/ui/feedback";
import { addDays, formatDate } from "@/core/dates";
import { formatMoney, toInputValue, tryParseMoney } from "@/core/money";
import { EXPENSE_CATEGORIES } from "@/core/validation/forms";
import {
  createBill,
  recordCustomerPayment,
  recordExpense,
  recordLoan,
  recordLoanRepayment,
  recordOwnerTransaction,
  recordStockPurchase,
  recordSupplierPayment,
  recordTransfer,
} from "@/lib/actions/transactions";
import { initialActionState, type ActionResult } from "@/lib/errors";
import { LineItems, PaymentFields, type AccountOption, type Option, type ProductOption } from "./shared";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

function useForm(action: Action, idempotencyKey: string) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const key = useIdempotencyKey(idempotencyKey, state);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return { state, formAction, key, errors, pending };
}

function DateField({ name = "txn_date", label = "Date", today, error, defaultValue }: { name?: string; label?: string; today: string; error?: string; defaultValue?: string }) {
  return (
    <Field label={label} error={error}>
      {(p) => <Input {...p} type="date" name={name} defaultValue={defaultValue ?? today} max={addDays(today, 1)} required />}
    </Field>
  );
}

function NotesField() {
  return (
    <Field label="Notes" optional>
      {(p) => <Textarea {...p} name="notes" maxLength={1000} />}
    </Field>
  );
}

// ---------------------------------------------------------------------------
export interface PlannedOccurrence {
  event_id: string;
  date: string;
  label: string;
  amount_minor: number;
}

export function ExpenseForm({
  accounts,
  suppliers,
  planned,
  today,
  idempotencyKey,
  prefill,
}: {
  accounts: AccountOption[];
  suppliers: Option[];
  planned: PlannedOccurrence[];
  today: string;
  idempotencyKey: string;
  prefill?: { description?: string; amount?: string; category?: string; date?: string; source?: string };
}) {
  const { state, formAction, key, errors, pending } = useForm(recordExpense, idempotencyKey);
  const [settles, setSettles] = useState("");
  const selected = planned.find((p) => `${p.event_id}|${p.date}` === settles);
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      {prefill?.source && <input type="hidden" name="source" value={prefill.source} />}
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" error={errors.amount}>
          {(p) => <MoneyInput {...p} name="amount" defaultValue={prefill?.amount ?? (selected ? toInputValue(selected.amount_minor) : "")} key={selected?.date ?? "x"} required />}
        </Field>
        <Field label="What was it for?" error={errors.category}>
          {(p) => (
            <Select {...p} name="category" defaultValue={prefill?.category && (EXPENSE_CATEGORIES as readonly string[]).includes(prefill.category) ? prefill.category : "Transport"}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description" optional error={errors.description}>
        {(p) => <Input {...p} name="description" defaultValue={prefill?.description} placeholder="e.g. Taxi to Circle market" maxLength={200} />}
      </Field>
      <DateField today={today} error={errors.txn_date} defaultValue={prefill?.date} />
      <PaymentFields accounts={accounts} errors={errors} />
      {planned.length > 0 && (
        <Field label="Does this pay a planned payment?" optional hint="Linking it stops the forecast from counting the planned payment again." error={errors.occurrence_date}>
          {(p) => (
            <Select {...p} value={settles} onChange={(e) => setSettles(e.target.value)}>
              <option value="">No</option>
              {planned.map((o) => (
                <option key={`${o.event_id}|${o.date}`} value={`${o.event_id}|${o.date}`}>
                  {o.label} — {formatDate(o.date)} ({formatMoney(o.amount_minor)})
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <input type="hidden" name="scheduled_event_id" value={selected?.event_id ?? ""} />
      <input type="hidden" name="occurrence_date" value={selected?.date ?? ""} />
      <Field label="Supplier" optional>
        {(p) => (
          <Select {...p} name="supplier_id" defaultValue="">
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <NotesField />
      <SubmitButton size="lg">Record expense</SubmitButton>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
export interface OpenInvoice {
  id: string;
  number: string;
  customer_id: string;
  outstanding_minor: number;
  due_date: string;
}

export function CustomerPaymentForm({
  customers,
  invoices,
  accounts,
  today,
  idempotencyKey,
  defaultCustomerId,
  prefill,
}: {
  customers: Option[];
  invoices: OpenInvoice[];
  accounts: AccountOption[];
  today: string;
  idempotencyKey: string;
  defaultCustomerId?: string;
  prefill?: { amount?: string; date?: string; source?: string };
}) {
  const { state, formAction, key, errors, pending } = useForm(recordCustomerPayment, idempotencyKey);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const open = invoices.filter((i) => i.customer_id === customerId);
  const owed = open.reduce((s, i) => s + i.outstanding_minor, 0);
  const withDebt = new Set(invoices.map((i) => i.customer_id));
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      {prefill?.source && <input type="hidden" name="source" value={prefill.source} />}
      <FormMessage state={state} />
      <Field label="Customer" error={errors.customer_id}>
        {(p) => (
          <Select {...p} name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Choose a customer</option>
            {customers.filter((c) => withDebt.has(c.id) || c.id === customerId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {customerId && (open.length === 0 ? <Notice tone="info">This customer has nothing outstanding.</Notice> : <p className="text-sm text-ink-soft">Owes {formatMoney(owed)} on {open.length} sale{open.length === 1 ? "" : "s"}.</p>)}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount received" error={errors.amount} hint="This reduces what they owe. It is not a new sale.">
          {(p) => <MoneyInput {...p} name="amount" defaultValue={prefill?.amount} required />}
        </Field>
        <Field label="Apply to" optional error={errors.invoice_id}>
          {(p) => (
            <Select {...p} name="invoice_id" defaultValue="" key={customerId}>
              <option value="">Oldest first</option>
              {open.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} — {formatMoney(i.outstanding_minor)} due {formatDate(i.due_date)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <DateField name="payment_date" label="Date received" today={today} error={errors.payment_date} defaultValue={prefill?.date} />
      <PaymentFields accounts={accounts} defaultMethod="mobile_money" errors={errors} />
      <Field label="Reference" optional hint="MoMo transaction ID or receipt number">
        {(p) => <Input {...p} name="reference" maxLength={80} />}
      </Field>
      <NotesField />
      <SubmitButton size="lg" disabled={!customerId || open.length === 0}>
        Record payment
      </SubmitButton>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
export interface OpenBill {
  id: string;
  number: string;
  supplier_id: string;
  outstanding_minor: number;
  due_date: string;
}

export function SupplierPaymentForm({
  suppliers,
  bills,
  accounts,
  today,
  idempotencyKey,
  defaultSupplierId,
}: {
  suppliers: Option[];
  bills: OpenBill[];
  accounts: AccountOption[];
  today: string;
  idempotencyKey: string;
  defaultSupplierId?: string;
}) {
  const { state, formAction, key, errors, pending } = useForm(recordSupplierPayment, idempotencyKey);
  const [supplierId, setSupplierId] = useState(defaultSupplierId ?? "");
  const open = bills.filter((b) => b.supplier_id === supplierId);
  const owed = open.reduce((s, b) => s + b.outstanding_minor, 0);
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <Field label="Supplier" error={errors.supplier_id}>
        {(p) => (
          <Select {...p} name="supplier_id" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {supplierId && (open.length === 0 ? <Notice tone="info">No unpaid bills from this supplier. To record stock you paid for today, use “Stock bought”.</Notice> : <p className="text-sm text-ink-soft">You owe {formatMoney(owed)} on {open.length} bill{open.length === 1 ? "" : "s"}.</p>)}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount paid" error={errors.amount} hint="This clears the bill. It is not a new expense.">
          {(p) => <MoneyInput {...p} name="amount" required />}
        </Field>
        <Field label="Bill" optional>
          {(p) => (
            <Select {...p} name="bill_id" defaultValue="" key={supplierId}>
              <option value="">Oldest first</option>
              {open.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number} — {formatMoney(b.outstanding_minor)} due {formatDate(b.due_date)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <DateField name="payment_date" label="Date paid" today={today} error={errors.payment_date} />
      <PaymentFields accounts={accounts} defaultMethod="mobile_money" errors={errors} />
      <Field label="Reference" optional>
        {(p) => <Input {...p} name="reference" maxLength={80} />}
      </Field>
      <SubmitButton size="lg" disabled={!supplierId || open.length === 0}>
        Record payment
      </SubmitButton>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
export function StockPurchaseForm({
  products,
  suppliers,
  accounts,
  today,
  idempotencyKey,
}: {
  products: ProductOption[];
  suppliers: Option[];
  accounts: AccountOption[];
  today: string;
  idempotencyKey: string;
}) {
  const { state, formAction, key, errors, pending } = useForm(recordStockPurchase, idempotencyKey);
  if (products.length === 0) return <Notice tone="info">Add your products in Inventory first, then record stock you buy.</Notice>;
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <Notice tone="info">For stock paid for now. If the supplier will be paid later, record a supplier bill instead.</Notice>
      <LineItems products={products} mode="cost" allowDescriptionOnly={false} error={errors.lines} />
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField today={today} error={errors.txn_date} />
        <Field label="Supplier" optional>
          {(p) => (
            <Select {...p} name="supplier_id" defaultValue="">
              <option value="">Not recorded</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <PaymentFields accounts={accounts} errors={errors} />
      <Field label="Reference" optional>
        {(p) => <Input {...p} name="reference" maxLength={80} />}
      </Field>
      <SubmitButton size="lg">Record stock bought</SubmitButton>
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
export function BillForm({
  products,
  suppliers,
  today,
  idempotencyKey,
  defaultSupplierId,
}: {
  products: ProductOption[];
  suppliers: Option[];
  today: string;
  idempotencyKey: string;
  defaultSupplierId?: string;
}) {
  const { state, formAction, key, errors, pending } = useForm(createBill, idempotencyKey);
  const [kind, setKind] = useState<"inventory" | "expense">("inventory");
  if (suppliers.length === 0) return <Notice tone="info">Add a supplier first (Suppliers → New supplier).</Notice>;
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier" error={errors.supplier_id}>
          {(p) => (
            <Select {...p} name="supplier_id" defaultValue={defaultSupplierId ?? ""} required>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="What is the bill for?">
          {(p) => (
            <Select {...p} name="kind" value={kind} onChange={(e) => setKind(e.target.value as "inventory" | "expense")}>
              <option value="inventory">Stock (adds to inventory)</option>
              <option value="expense">A service or expense (e.g. rent)</option>
            </Select>
          )}
        </Field>
      </div>
      {kind === "inventory" ? (
        <LineItems key="inv" products={products} mode="cost" allowDescriptionOnly={false} error={errors.lines} />
      ) : (
        <>
          <ExpenseBillLines error={errors.lines} />
          <Field label="Category">
            {(p) => (
              <Select {...p} name="category" defaultValue="Rent">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField name="bill_date" label="Bill date" today={today} error={errors.bill_date} />
        <Field label="Due date" optional hint="Defaults to the supplier's payment terms." error={errors.due_date}>
          {(p) => <Input {...p} type="date" name="due_date" min={today} />}
        </Field>
      </div>
      <Field label="Supplier's invoice number" optional>
        {(p) => <Input {...p} name="supplier_reference" maxLength={80} />}
      </Field>
      <NotesField />
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg" name="post" value="post">
          Save bill
        </SubmitButton>
        <SubmitButton size="lg" variant="secondary" name="post" value="draft">
          Save as draft
        </SubmitButton>
      </div>
      <p className="text-xs text-ink-muted">Drafts are not counted in your figures or forecast until you post them.</p>
    </ActionForm>
  );
}

function ExpenseBillLines({ error }: { error?: string }) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const minor = tryParseMoney(amount);
  const valid = Boolean(desc.trim()) && minor !== null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="lines" value={JSON.stringify(valid ? [{ description: desc.trim(), quantity: 1, unit_cost_minor: minor }] : [])} />
      <Field label="Description" error={error}>
        {(p) => <Input {...p} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Shop rent for November" maxLength={200} />}
      </Field>
      <Field label="Amount">
        {(p) => <MoneyInput {...p} value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function LoanForm({ accounts, today, idempotencyKey }: { accounts: AccountOption[]; today: string; idempotencyKey: string }) {
  const { state, formAction, key, errors, pending } = useForm(recordLoan, idempotencyKey);
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <Notice tone="info">A loan increases your cash but it is not income — you will have to pay it back.</Notice>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lender" error={errors.lender}>
          {(p) => <Input {...p} name="lender" placeholder="e.g. Susu group, bank, family" maxLength={120} required />}
        </Field>
        <Field label="Amount received" error={errors.amount}>
          {(p) => <MoneyInput {...p} name="amount" required />}
        </Field>
      </div>
      <DateField today={today} error={errors.txn_date} />
      <PaymentFields accounts={accounts} defaultMethod="bank_transfer" errors={errors} />
      <NotesField />
      <SubmitButton size="lg">Record loan</SubmitButton>
    </ActionForm>
  );
}

export function LoanRepaymentForm({ loans, accounts, today, idempotencyKey }: { loans: Option[]; accounts: AccountOption[]; today: string; idempotencyKey: string }) {
  const { state, formAction, key, errors, pending } = useForm(recordLoanRepayment, idempotencyKey);
  if (loans.length === 0) return <Notice tone="info">No loans recorded yet. Record the loan first.</Notice>;
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <Field label="Loan" error={errors.loan_id}>
        {(p) => (
          <Select {...p} name="loan_id" required>
            {loans.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Principal repaid" hint="Reduces what you owe" error={errors.principal}>
          {(p) => <MoneyInput {...p} name="principal" />}
        </Field>
        <Field label="Interest paid" hint="Recorded as a cost of borrowing" error={errors.interest}>
          {(p) => <MoneyInput {...p} name="interest" />}
        </Field>
      </div>
      <DateField today={today} error={errors.txn_date} />
      <PaymentFields accounts={accounts} defaultMethod="bank_transfer" errors={errors} />
      <SubmitButton size="lg">Record repayment</SubmitButton>
    </ActionForm>
  );
}

export function OwnerMoneyForm({ accounts, today, idempotencyKey }: { accounts: AccountOption[]; today: string; idempotencyKey: string }) {
  const { state, formAction, key, errors, pending } = useForm(recordOwnerTransaction, idempotencyKey);
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <Field label="Direction">
        {(p) => (
          <Select {...p} name="direction" defaultValue="in">
            <option value="in">I put my own money into the business</option>
            <option value="out">I took money out for personal use</option>
          </Select>
        )}
      </Field>
      <Notice tone="info">Owner money is not a sale or an expense, so it does not change your profit.</Notice>
      <Field label="Amount" error={errors.amount}>
        {(p) => <MoneyInput {...p} name="amount" required />}
      </Field>
      <DateField today={today} error={errors.txn_date} />
      <PaymentFields accounts={accounts} errors={errors} />
      <Field label="Description" optional>
        {(p) => <Input {...p} name="description" maxLength={200} />}
      </Field>
      <SubmitButton size="lg">Record</SubmitButton>
    </ActionForm>
  );
}

export function TransferForm({ accounts, today, idempotencyKey }: { accounts: AccountOption[]; today: string; idempotencyKey: string }) {
  const { state, formAction, key, errors, pending } = useForm(recordTransfer, idempotencyKey);
  if (accounts.length < 2) return <Notice tone="info">You need two money accounts (e.g. Cash and Mobile Money) to record a transfer. Add one in Settings.</Notice>;
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <Notice tone="info">Moving money between your own accounts is not income or an expense.</Notice>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" error={errors.from_account_id}>
          {(p) => (
            <Select {...p} name="from_account_id" defaultValue={accounts[1]?.id}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="To" error={errors.to_account_id}>
          {(p) => (
            <Select {...p} name="to_account_id" defaultValue={accounts[0]?.id}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Amount" error={errors.amount}>
        {(p) => <MoneyInput {...p} name="amount" required />}
      </Field>
      <DateField today={today} error={errors.txn_date} />
      <NotesField />
      <SubmitButton size="lg">Record transfer</SubmitButton>
    </ActionForm>
  );
}
