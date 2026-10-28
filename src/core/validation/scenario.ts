// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import { z } from "zod";
import { isIsoDate } from "../dates";

const MAX_MINOR = 100_000_000_000; // GH₵1bn per adjustment — far beyond any small shop, blocks overflow abuse.

const isoDate = z.string().refine(isIsoDate, "Use a valid date (YYYY-MM-DD)");
const amountMinor = z.number().int("Amount must be in whole pesewas").positive("Amount must be greater than zero").max(MAX_MINOR);
const dayOffset = z.number().int().min(0).max(366);
const label = z.string().trim().min(1, "Give this change a short name").max(120);
const pct = z.number().min(-100, "Cannot fall by more than 100%").max(500);

/** Either an absolute date or a day offset from the forecast start (offsets keep saved scenarios valid over time). */
const when = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, date: isoDate.optional(), day_offset: dayOffset.optional() })
    .refine((v) => (v.date === undefined) !== (v.day_offset === undefined), {
      message: "Choose a date",
      path: ["date"],
    });

export const oneOffAdjustment = when({
  kind: z.literal("one_off"),
  direction: z.enum(["in", "out"]),
  amount_minor: amountMinor,
  label,
  category: z.string().trim().max(60).optional(),
});

export const recurringAdjustment = z
  .object({
    kind: z.literal("recurring"),
    direction: z.enum(["in", "out"]),
    amount_minor: amountMinor,
    label,
    category: z.string().trim().max(60).optional(),
    interval: z.enum(["weekly", "monthly"]),
    start_date: isoDate.optional(),
    start_offset: dayOffset.optional(),
  })
  .refine((v) => (v.start_date === undefined) !== (v.start_offset === undefined), {
    message: "Choose a start date",
    path: ["start_date"],
  });

export const delayEventAdjustment = z.object({
  kind: z.literal("delay_event"),
  event_ref: z.string().min(1).max(200),
  days: z.number().int().min(1).max(180),
});

export const collectEarlyAdjustment = when({
  kind: z.literal("collect_early"),
  invoice_id: z.string().uuid(),
});

export const salesChangeAdjustment = z.object({ kind: z.literal("sales_change_pct"), pct });
export const supplierPriceAdjustment = z.object({ kind: z.literal("supplier_price_change_pct"), pct });
export const excludeEventAdjustment = z.object({ kind: z.literal("exclude_event"), event_ref: z.string().min(1).max(200) });

// Refined objects cannot sit in a discriminatedUnion, so a plain union is used;
// each member is keyed by its literal `kind`.
export const scenarioAdjustment = z.union([
  oneOffAdjustment,
  recurringAdjustment,
  delayEventAdjustment,
  collectEarlyAdjustment,
  salesChangeAdjustment,
  supplierPriceAdjustment,
  excludeEventAdjustment,
]);
export type ScenarioAdjustment = z.infer<typeof scenarioAdjustment>;

export const scenarioSchema = z.object({
  name: z.string().trim().min(1, "Name the scenario").max(120),
  description: z.string().trim().max(1000).optional().default(""),
  horizon_days: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60), z.literal(90)]).default(30),
  adjustments: z.array(scenarioAdjustment).max(20, "A scenario can have at most 20 changes"),
});
export type ScenarioInput = z.infer<typeof scenarioSchema>;
