// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
import { z } from "zod";
import { isIsoDate } from "../dates";
import { MoneyError, parseMoney } from "../money";
import { PAYMENT_METHODS } from "../finance/types";

/** Required money input ("1,250.00") → minor units. */
export const money = (opts: { allowZero?: boolean; label?: string } = {}) =>
  z
    .string({ required_error: `${opts.label ?? "Amount"} is required` })
    .trim()
    .transform((value, ctx) => {
      try {
        return parseMoney(value, { allowZero: opts.allowZero });
      } catch (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: err instanceof MoneyError ? err.message : "Invalid amount" });
        return z.NEVER;
      }
    });

/** Optional money input: empty → null. */
export const optionalMoney = (opts: { allowZero?: boolean } = { allowZero: true }) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === "") return null;
      try {
        return parseMoney(value, { allowZero: opts.allowZero ?? true });
      } catch (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: err instanceof MoneyError ? err.message : "Invalid amount" });
        return z.NEVER;
      }
    });

/** Already-minor integer (from JSON payloads built by the client). */
export const minorInt = (label = "Amount") =>
  z.number({ invalid_type_error: `${label} must be a number` }).int(`${label} must be whole pesewas`).min(0, `${label} cannot be negative`).max(1e13);

export const isoDate = (label = "Date") =>
  z.string({ required_error: `${label} is required` }).trim().refine(isIsoDate, `${label} must be a valid date`);

export const optionalIsoDate = (label = "Date") =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || isIsoDate(v), `${label} must be a valid date`);

export const uuid = (label = "Selection") => z.string().trim().uuid(`${label} is not valid`);

export const optionalUuid = (label = "Selection") =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, `${label} is not valid`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

export const requiredText = (label: string, max: number) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `Keep this under ${max} characters`);

export const paymentMethod = z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Choose how the money was paid" }) });

export const quantity = (label = "Quantity") =>
  z.coerce.number({ invalid_type_error: `${label} must be a number` }).int(`${label} must be a whole number`).positive(`${label} must be greater than zero`).max(1_000_000);

export const idempotencyKey = z.string().uuid("Missing request key — please refresh and try again");

/** Ghana phone: allows +233 / 0 prefixes, spaces and dashes. */
export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^\+?[0-9 ()-]{6,20}$/.test(v), "Enter a valid phone number, e.g. 024 555 0101");

/** Parse a JSON string field (used for line items built by the client). */
export const jsonArray = <T extends z.ZodTypeAny>(item: T, opts: { min?: number; max?: number; label?: string } = {}) =>
  z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${opts.label ?? "Items"} could not be read`, fatal: true });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(item)
        .min(opts.min ?? 1, `Add at least ${opts.min ?? 1} ${opts.label?.toLowerCase() ?? "item"}`)
        .max(opts.max ?? 100, `At most ${opts.max ?? 100} ${opts.label?.toLowerCase() ?? "items"}`),
    );

/** Flatten Zod issues into { field: message } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
