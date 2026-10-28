// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, Select } from "@/components/ui/field";
import { addDays, formatDate } from "@/core/dates";
import { formatMoney, tryParseMoney } from "@/core/money";
import type { ForecastEvent } from "@/core/forecast/types";
import { scenarioAdjustment, type ScenarioAdjustment } from "@/core/validation/scenario";

const KINDS = [
  ["one_off", "Spend or receive money once"],
  ["recurring", "A new regular cost (e.g. hire someone)"],
  ["collect_early", "A customer pays on a different day"],
  ["delay_event", "Move a bill or payment later"],
  ["exclude_event", "Something doesn't happen (e.g. customer never pays)"],
  ["sales_change_pct", "Sales go up or down"],
  ["supplier_price_change_pct", "Supplier prices change"],
] as const;

type Kind = (typeof KINDS)[number][0];

/**
 * Builds one validated scenario adjustment. Validation uses the same Zod
 * schema the server uses when saving.
 */
export function AdjustmentEditor({
  today,
  events,
  invoices,
  onAdd,
}: {
  today: string;
  events: ForecastEvent[];
  invoices: { id: string; label: string; due_date: string }[];
  onAdd: (a: ScenarioAdjustment) => void;
}) {
  const [kind, setKind] = useState<Kind>("one_off");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("2000");
  const [label, setLabel] = useState("Stock purchase");
  const [category, setCategory] = useState("Stock purchases");
  const [offset, setOffset] = useState("1");
  const [interval, setInterval] = useState<"monthly" | "weekly">("monthly");
  const [eventRef, setEventRef] = useState("");
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? "");
  const [days, setDays] = useState("7");
  const [pct, setPct] = useState("-20");
  const [error, setError] = useState<string | null>(null);

  const movable = events.filter((e) => e.amount < 0 && e.category !== "projected_purchases" && e.category !== "scenario");
  const removable = events.filter((e) => e.category !== "projected_sales" && e.category !== "projected_purchases" && e.category !== "scenario");

  function build(): unknown {
    const minor = tryParseMoney(amount);
    const day_offset = Number(offset);
    switch (kind) {
      case "one_off":
        return { kind, direction, amount_minor: minor, label: label.trim(), category: category.trim() || undefined, day_offset };
      case "recurring":
        return { kind, direction: "out", amount_minor: minor, label: label.trim(), interval, start_offset: day_offset };
      case "collect_early":
        return { kind, invoice_id: invoiceId, day_offset };
      case "delay_event":
        return { kind, event_ref: eventRef, days: Number(days) };
      case "exclude_event":
        return { kind, event_ref: eventRef };
      case "sales_change_pct":
      case "supplier_price_change_pct":
        return { kind, pct: Number(pct) };
    }
  }

  function add() {
    const parsed = scenarioAdjustment.safeParse(build());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the values");
      return;
    }
    setError(null);
    onAdd(parsed.data);
  }

  const offsetField = (lbl: string) => (
    <Field label={lbl} hint={formatDate(addDays(today, Number(offset)))}>
      {(p) => (
        <Select {...p} value={offset} onChange={(e) => setOffset(e.target.value)}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 30, 45, 60].map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  return (
    <div className="space-y-3 rounded-lg border border-line bg-canvas/40 p-3">
      <Field label="What if…">
        {(p) => (
          <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {(kind === "one_off" || kind === "recurring") && (
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === "one_off" && (
            <Field label="Money">
              {(p) => (
                <Select {...p} value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
                  <option value="out">Goes out (spend)</option>
                  <option value="in">Comes in</option>
                </Select>
              )}
            </Field>
          )}
          {kind === "recurring" && (
            <Field label="How often">
              {(p) => (
                <Select {...p} value={interval} onChange={(e) => setInterval(e.target.value as "monthly" | "weekly")}>
                  <option value="monthly">Every month</option>
                  <option value="weekly">Every week</option>
                </Select>
              )}
            </Field>
          )}
          <Field label="Amount">{(p) => <MoneyInput {...p} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Name">{(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />}</Field>
          {kind === "one_off" ? offsetField("When") : offsetField("Starting")}
          {kind === "one_off" && direction === "out" && (
            <Field label="Kind of spend" hint="“Stock purchases” are affected by supplier price changes">
              {(p) => (
                <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option>Stock purchases</option>
                  <option>Equipment</option>
                  <option>Rent</option>
                  <option>Wages</option>
                  <option>Other</option>
                </Select>
              )}
            </Field>
          )}
        </div>
      )}

      {kind === "collect_early" &&
        (invoices.length === 0 ? (
          <p className="text-sm text-ink-muted">No customers owe you money right now.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer payment">
              {(p) => (
                <Select {...p} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                  {invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label} (due {formatDate(i.due_date, { year: false })})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {offsetField("They pay on")}
          </div>
        ))}

      {(kind === "delay_event" || kind === "exclude_event") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={kind === "delay_event" ? "Payment to move" : "Item"}>
            {(p) => (
              <Select {...p} value={eventRef} onChange={(e) => setEventRef(e.target.value)}>
                <option value="">Choose…</option>
                {(kind === "delay_event" ? movable : removable).map((e) => (
                  <option key={e.ref} value={e.ref}>
                    {e.label} · {formatMoney(Math.abs(e.amount))} · {formatDate(e.date, { year: false })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {kind === "delay_event" && (
            <Field label="By how many days">{(p) => <Input {...p} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))} />}</Field>
          )}
        </div>
      )}

      {(kind === "sales_change_pct" || kind === "supplier_price_change_pct") && (
        <Field label="Change (%)" hint={kind === "sales_change_pct" ? "e.g. -20 for sales 20% lower. Uses your recent average sales." : "e.g. 10 for prices 10% higher. Affects future stock purchases only."}>
          {(p) => <Input {...p} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />}
        </Field>
      )}

      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={add}>
        <Plus className="size-4" aria-hidden /> Add to scenario
      </Button>
    </div>
  );
}

