// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import type { ZodError } from "zod";
import { fieldErrors } from "@/core/validation/fields";

/** Result returned by every server action. */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const initialActionState: ActionResult<never> = { ok: true };

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Translate a database error into a message an owner can act on, without
 * leaking internals. Business-rule errors (SQLSTATE P0001) are written for
 * owners in the posting functions and are shown as-is.
 */
export function dbErrorMessage(error: DbError): string {
  switch (error.code) {
    case "P0001":
      return error.message ?? "That action is not allowed.";
    case "42501":
      return "You don't have permission to do that for this business.";
    case "23505":
      return "This looks like a duplicate — it has already been recorded.";
    case "23514":
    case "22023":
    case "22P02":
      return "Some of the details are not valid. Please check the form and try again.";
    case "PGRST301":
    case "401":
      return "Your session has expired. Please sign in again.";
    default:
      console.error("[db]", error.code, error.message, error.details);
      return "Something went wrong while saving. Nothing was recorded — please try again.";
  }
}

export function fromDbError(error: DbError): ActionResult<never> {
  return { ok: false, error: dbErrorMessage(error) };
}

export function fromZodError(error: ZodError): ActionResult<never> {
  const fields = fieldErrors(error);
  return { ok: false, error: fields._form ?? "Please fix the highlighted fields.", fieldErrors: fields };
}

/** Convert FormData into a plain object of strings (last value wins). */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}
