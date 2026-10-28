// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select } from "@/components/ui/field";
import { METHOD_LABEL } from "@/components/txn-labels";
import { formatMoney, toInputValue, tryParseMoney } from "@/core/money";
import { PAYMENT_METHODS } from "@/core/finance/types";

export interface Option {
  id: string;
  name: string;
}
export interface ProductOption extends Option {
  selling_price_minor: number;
  last_unit_cost_minor: number;
  quantity_on_hand: number;
}
export interface AccountOption extends Option {
  kind: "cash" | "mobile_money" | "bank";
}

/** Payment method + (optional) specific money account. */
export function PaymentFields({ accounts, defaultMethod = "cash", errors = {} }: { accounts: AccountOption[]; defaultMethod?: string; errors?: Record<string, string> }) {
  const [method, setMethod] = useState(defaultMethod);
  const kindFor: Record<string, string> = { cash: "cash", mobile_money: "mobile_money", bank_transfer: "bank", card: "bank" };
  const matching = accounts.filter((a) => a.kind === kindFor[method]);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Paid by" error={errors.payment_method}>
        {(p) => (
          <Select {...p} name="payment_method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Money account" hint={matching.length === 0 ? "Uses your default account" : undefined} error={errors.financial_account_id}>
        {(p) => (
          <Select {...p} name="financial_account_id" defaultValue="" key={method}>
            <option value="">{matching[0] ? `${matching[0].name} (default)` : "Default account"}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

export interface LineState {
  key: string;
  product_id: string;
  description: string;
  quantity: string;
  price: string;
}

/** Keys are deterministic per component instance so server and client HTML match. */
const newLine = (key: string, over: Partial<LineState> = {}): LineState => ({ key, product_id: "", description: "", quantity: "1", price: "", ...over });

/**
 * Line items editor. Builds a JSON array in a hidden input (`lines`) with
 * quantities and prices already converted to integer minor units.
 * mode "sale" uses selling price; "cost" uses unit cost and requires products.
 */
export function LineItems({
  products,
  mode,
  allowDescriptionOnly = true,
  currency = "GHS",
  initial,
  error,
}: {
  products: ProductOption[];
  mode: "sale" | "cost";
  allowDescriptionOnly?: boolean;
  currency?: string;
  initial?: Partial<LineState>[];
  error?: string;
}) {
  const uid = useId();
  const seq = useRef(initial?.length || 1);
  const [lines, setLines] = useState<LineState[]>(() => (initial?.length ? initial.map((l, i) => newLine(`${uid}-${i}`, l)) : [newLine(`${uid}-0`)]));
  const addLine = () => setLines((ls) => [...ls, newLine(`${uid}-${seq.current++}`)]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const update = (key: string, patch: Partial<LineState>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (patch.product_id !== undefined) {
          const p = byId.get(patch.product_id);
          if (p) next.price = toInputValue(mode === "sale" ? p.selling_price_minor : p.last_unit_cost_minor);
        }
        return next;
      }),
    );

  const parsed = lines.map((l) => {
    const qty = Number(l.quantity);
    const price = tryParseMoney(l.price, { allowZero: true });
    const valid = Number.isInteger(qty) && qty > 0 && price !== null && (l.product_id || (allowDescriptionOnly && l.description.trim()));
    return { l, qty, price, valid };
  });
  const total = parsed.reduce((s, x) => (x.valid ? s + x.qty * (x.price ?? 0) : s), 0);
  const payload = parsed
    .filter((x) => x.valid)
    .map((x) =>
      mode === "sale"
        ? { product_id: x.l.product_id || null, description: x.l.description.trim() || undefined, quantity: x.qty, unit_price_minor: x.price }
        : { product_id: x.l.product_id || null, description: x.l.description.trim() || undefined, quantity: x.qty, unit_cost_minor: x.price },
    );

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-sm font-medium text-ink">Items</legend>
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      {lines.map((l, i) => {
        const product = byId.get(l.product_id);
        const short = mode === "sale" && product && Number(l.quantity) > product.quantity_on_hand;
        return (
          <div key={l.key} className="rounded-lg border border-line bg-canvas/40 p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_90px_140px_auto] sm:items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-ink-soft" htmlFor={`${l.key}-p`}>
                  Product {i + 1}
                </label>
                <Select id={`${l.key}-p`} value={l.product_id} onChange={(e) => update(l.key, { product_id: e.target.value })}>
                  <option value="">{allowDescriptionOnly ? "— Not a stock item —" : "Choose a product"}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {mode === "sale" ? `(${p.quantity_on_hand} in stock)` : ""}
                    </option>
                  ))}
                </Select>
                {!l.product_id && allowDescriptionOnly && (
                  <Input aria-label={`Description for item ${i + 1}`} placeholder="What was sold (e.g. Phone repair)" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} maxLength={200} />
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-ink-soft" htmlFor={`${l.key}-q`}>
                  Qty
                </label>
                <Input id={`${l.key}-q`} inputMode="numeric" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value.replace(/[^\d]/g, "") })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-ink-soft" htmlFor={`${l.key}-pr`}>
                  {mode === "sale" ? "Price each" : "Cost each"}
                </label>
                <MoneyInput id={`${l.key}-pr`} value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            {short && (
              <p className="mt-2 text-xs font-medium text-warning" role="alert">
                Only {product!.quantity_on_hand} in stock. Record stock received first, or the sale will be refused.
              </p>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button type="button" variant="secondary" size="sm" onClick={addLine} disabled={lines.length >= 100}>
          <Plus className="size-4" /> Add item
        </Button>
        <p className="text-sm">
          Total <span className="tabular ml-1 text-base font-semibold">{formatMoney(total, { currency })}</span>
        </p>
      </div>
      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
