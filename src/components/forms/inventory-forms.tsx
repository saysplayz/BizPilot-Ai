// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select, Textarea } from "@/components/ui/field";
import { ActionForm, FormMessage, useIdempotencyKey } from "@/components/ui/form";
import { toInputValue } from "@/core/money";
import { recordOpeningStock, recordStockAdjustment, saveProduct } from "@/lib/actions/records";
import { initialActionState } from "@/lib/errors";
import type { Option } from "./shared";

export interface ProductValues {
  id?: string;
  name: string;
  sku: string | null;
  description: string | null;
  selling_price_minor: number;
  last_unit_cost_minor: number;
  low_stock_threshold: number;
  supplier_id: string | null;
  barcode: string | null;
  expiry_date: string | null;
}

export function ProductForm({ suppliers, product, idempotencyKey }: { suppliers: Option[]; product?: ProductValues; idempotencyKey: string }) {
  const [state, action, pending] = useActionState(saveProduct, initialActionState);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  const isNew = !product?.id;
  return (
    <ActionForm action={action} pending={pending} className="space-y-4" noValidate>
      {product?.id && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <FormMessage state={state} />
      <Field label="Product name" error={errors.name}>
        {(p) => <Input {...p} name="name" defaultValue={product?.name} required maxLength={120} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Selling price" error={errors.selling_price}>
          {(p) => <MoneyInput {...p} name="selling_price" defaultValue={product ? toInputValue(product.selling_price_minor) : ""} required />}
        </Field>
        <Field label="Unit cost" optional hint="What you pay the supplier per unit. Needed for accurate profit." error={errors.unit_cost}>
          {(p) => <MoneyInput {...p} name="unit_cost" defaultValue={product?.last_unit_cost_minor ? toInputValue(product.last_unit_cost_minor) : ""} />}
        </Field>
      </div>
      {isNew && (
        <Field label="How many do you have now?" optional hint="Recorded as opening stock at the unit cost above." error={errors.opening_quantity}>
          {(p) => <Input {...p} name="opening_quantity" inputMode="numeric" pattern="[0-9]*" placeholder="0" />}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Warn me when stock falls to" error={errors.low_stock_threshold}>
          {(p) => <Input {...p} name="low_stock_threshold" inputMode="numeric" defaultValue={String(product?.low_stock_threshold ?? 3)} />}
        </Field>
        <Field label="Supplier" optional>
          {(p) => (
            <Select {...p} name="supplier_id" defaultValue={product?.supplier_id ?? ""}>
              <option value="">None</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <details className="rounded-lg border border-line px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-ink-soft">More details (SKU, barcode, expiry)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="SKU / code" optional error={errors.sku}>
            {(p) => <Input {...p} name="sku" defaultValue={product?.sku ?? ""} maxLength={60} />}
          </Field>
          <Field label="Barcode" optional>
            {(p) => <Input {...p} name="barcode" defaultValue={product?.barcode ?? ""} maxLength={64} />}
          </Field>
          <Field label="Expiry date" optional error={errors.expiry_date}>
            {(p) => <Input {...p} type="date" name="expiry_date" defaultValue={product?.expiry_date ?? ""} />}
          </Field>
          <Field label="Description" optional className="sm:col-span-2">
            {(p) => <Textarea {...p} name="description" defaultValue={product?.description ?? ""} maxLength={1000} />}
          </Field>
        </div>
      </details>
      <SubmitButton size="lg">{isNew ? "Add product" : "Save changes"}</SubmitButton>
    </ActionForm>
  );
}

export function StockAdjustmentForm({ productId, today, idempotencyKey, onHand }: { productId: string; today: string; idempotencyKey: string; onHand: number }) {
  const [state, action, pending] = useActionState(recordStockAdjustment, initialActionState);
  const key = useIdempotencyKey(idempotencyKey, state);
  const [direction, setDirection] = useState<"remove" | "add">("remove");
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <ActionForm action={action} pending={pending} className="space-y-3" noValidate>
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <input type="hidden" name="txn_date" value={today} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Change">
          {(p) => (
            <Select {...p} name="direction" value={direction} onChange={(e) => setDirection(e.target.value as "add" | "remove")}>
              <option value="remove">Remove (damaged, lost, counted less)</option>
              <option value="add">Add (found, counted more)</option>
            </Select>
          )}
        </Field>
        <Field label="Quantity" hint={direction === "remove" ? `${onHand} in stock` : undefined} error={errors.quantity}>
          {(p) => <Input {...p} name="quantity" inputMode="numeric" required />}
        </Field>
      </div>
      {direction === "add" && (
        <Field label="Cost per unit" optional hint="Defaults to the current average cost">
          {(p) => <MoneyInput {...p} name="unit_cost" />}
        </Field>
      )}
      <Field label="Reason" error={errors.reason}>
        {(p) => <Input {...p} name="reason" required maxLength={500} placeholder="e.g. Stock count on Friday" />}
      </Field>
      <SubmitButton variant="secondary">Adjust stock</SubmitButton>
    </ActionForm>
  );
}

export function OpeningStockForm({ productId, today, idempotencyKey, defaultCost }: { productId: string; today: string; idempotencyKey: string; defaultCost: number }) {
  const [state, action, pending] = useActionState(recordOpeningStock, initialActionState);
  const key = useIdempotencyKey(idempotencyKey, state);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  return (
    <ActionForm action={action} pending={pending} className="space-y-3" noValidate>
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Quantity on hand" error={errors.quantity}>
          {(p) => <Input {...p} name="quantity" inputMode="numeric" required />}
        </Field>
        <Field label="Cost per unit" error={errors.unit_cost}>
          {(p) => <MoneyInput {...p} name="unit_cost" defaultValue={defaultCost ? toInputValue(defaultCost) : ""} required />}
        </Field>
        <Field label="As of" error={errors.txn_date}>
          {(p) => <Input {...p} type="date" name="txn_date" defaultValue={today} max={today} required />}
        </Field>
      </div>
      <SubmitButton variant="secondary">Set opening stock</SubmitButton>
    </ActionForm>
  );
}
