// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
/**
 * A Fact is a figure produced by BizPilot's own calculations. AI answers may
 * only state money figures that appear as facts (or that the user typed);
 * anything else is flagged to the user as unverified.
 */
import { formatDate, type IsoDate } from "../dates";
import { formatMoney, type Minor } from "../money";

export type FactKind = "money" | "date" | "count" | "percent" | "text";

export interface Fact {
  label: string;
  /** Display value, e.g. "GH₵3,000.00". */
  value: string;
  kind: FactKind;
  /** Minor units for money facts; used by the answer validator. */
  minor?: Minor;
  /** Which calculation produced it (tool name). */
  source: string;
}

export const moneyFact = (label: string, minor: Minor, source: string, currency = "GHS"): Fact => ({
  label,
  value: formatMoney(minor, { currency }),
  kind: "money",
  minor,
  source,
});

export const dateFact = (label: string, date: IsoDate, source: string): Fact => ({
  label,
  value: formatDate(date),
  kind: "date",
  source,
});

export const countFact = (label: string, n: number, source: string): Fact => ({ label, value: String(n), kind: "count", source });

export const textFact = (label: string, value: string, source: string): Fact => ({ label, value, kind: "text", source });

export const percentFact = (label: string, pct: number | null, source: string): Fact => ({
  label,
  value: pct === null ? "n/a" : `${pct}%`,
  kind: "percent",
  source,
});

/** De-duplicate facts by label+value, preserving order. */
export function mergeFacts(...groups: Fact[][]): Fact[] {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const f of groups.flat()) {
    const key = `${f.label}|${f.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}
