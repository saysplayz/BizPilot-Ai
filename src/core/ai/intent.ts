// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
/**
 * Lightweight intent detection used when no LLM is configured (and to extract
 * amounts/dates the user typed). Deliberately simple and predictable.
 */
import { addDays, type IsoDate } from "../dates";
import type { Minor } from "../money";
import { extractMoneyMentions } from "./validate";

export type Intent =
  | "cash_position"
  | "receivables"
  | "restock"
  | "affordability"
  | "bills"
  | "expenses"
  | "profit"
  | "forecast"
  | "scenario"
  | "unknown";

export interface ParsedQuestion {
  intent: Intent;
  amounts: Minor[];
  /** Day offset from today when the user mentions timing ("tomorrow", "next week", "in 5 days"). */
  dayOffset: number | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseDayOffset(text: string, today: IsoDate): number | null {
  const t = text.toLowerCase();
  if (/\btoday\b|\bnow\b|right away/.test(t)) return 0;
  if (/\btomorrow\b/.test(t)) return 1;
  if (/next week/.test(t)) return 7;
  if (/next month/.test(t)) return 30;
  if (/end of (the )?month/.test(t)) return null;
  const inDays = /in (\d{1,3}) days?/.exec(t);
  if (inDays) return Number(inDays[1]);
  const inWeeks = /in (\d{1,2}) weeks?/.exec(t);
  if (inWeeks) return Number(inWeeks[1]) * 7;
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b(on |this |next )?${WEEKDAYS[i]}\\b`).test(t)) {
      const diff = (i - dow + 7) % 7 || 7;
      return diff;
    }
  }
  return null;
}

/** Amounts typed without a currency symbol, e.g. "spend 2000 on stock". */
function bareAmounts(text: string): Minor[] {
  const out: Minor[] = [];
  for (const m of text.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{3,9})(?:\.(\d{1,2}))?\b(?!\s?(?:days?|weeks?|months?|units?|pcs|pieces|%))/g)) {
    const whole = Number(m[1]!.replace(/,/g, ""));
    if (whole >= 1900 && whole <= 2100 && !m[2]) continue; // likely a year
    out.push(whole * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0"));
  }
  return out;
}

export function parseQuestion(question: string, today: IsoDate): ParsedQuestion {
  const q = question.toLowerCase();
  const symbolAmounts = extractMoneyMentions(question).map((m) => m.minor);
  const amounts = symbolAmounts.length > 0 ? symbolAmounts : bareAmounts(question);
  const dayOffset = parseDayOffset(question, today);

  let intent: Intent = "unknown";
  if (/\bscenario|what[- ]if\b|compare.*forecast/.test(q)) intent = "scenario";
  else if (/afford|can i (buy|spend|pay|restock|purchase|hire)|should i (buy|spend|restock|purchase)|enough (cash|money) (to|for)/.test(q)) intent = "affordability";
  else if (/restock|low stock|running (low|out)|re-?order|out of stock|need.*(stock|buy more)/.test(q)) intent = "restock";
  else if (/\bowe[sd]?\b|debt|debtor|receivable|who.*(pay|paid) me|outstanding.*customer|customer.*outstanding/.test(q)) intent = "receivables";
  else if (/\bbills?\b|pay first|prepare for|supplier|payable|due (soon|this week)|obligation/.test(q)) intent = "bills";
  else if (/expense|spending|spent|largest cost|biggest cost|where.*money go/.test(q)) intent = "expenses";
  else if (/profit|margin|lower this month|making money|loss/.test(q)) intent = "profit";
  else if (/forecast|end of (the )?month|next (week|month)|might i have|run out|future|cash flow|cashflow|shortage/.test(q)) intent = "forecast";
  else if (/how much (cash|money)|cash (do i|i) have|money (do i|i) have|balance|cash position|in (the )?till/.test(q)) intent = "cash_position";

  if (intent === "affordability" && amounts.length === 0) intent = "forecast";
  return { intent, amounts, dayOffset };
}

/** Resolve a day offset to a date, defaulting to tomorrow for purchases. */
export function resolveOffset(today: IsoDate, offset: number | null, fallback = 1): IsoDate {
  return addDays(today, offset ?? fallback);
}
