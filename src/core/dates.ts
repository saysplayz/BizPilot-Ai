// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * Business dates are ISO calendar dates ("YYYY-MM-DD") in the business's
 * timezone (Africa/Accra: UTC+0, no daylight saving). Arithmetic is done in
 * UTC on the calendar date only, so it is immune to server timezones.
 * Timestamps (created_at etc.) are stored in UTC by the database.
 */

export type IsoDate = string;

export const DEFAULT_TIMEZONE = "Africa/Accra";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

function toUtc(date: IsoDate): Date {
  if (!isIsoDate(date)) throw new RangeError(`Invalid date: ${date}`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in the given timezone. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Add calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: IsoDate, months: number, anchorDay?: number): IsoDate {
  const d = toUtc(date);
  const day = anchorDay ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target);
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/** Inclusive list of dates from start to end. */
export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  return addDays(addMonths(startOfMonth(date), 1), -1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Ghanaian display convention, day first: "28 Oct 2026". */
export function formatDate(date: IsoDate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = toUtc(date);
  const parts = [`${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`];
  if (opts.year !== false) parts[0] += ` ${d.getUTCFullYear()}`;
  return opts.weekday ? `${WEEKDAYS[d.getUTCDay()]} ${parts[0]}` : parts[0]!;
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDay(date: IsoDate, today: IsoDate): string {
  const n = diffDays(today, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Format a UTC timestamp for display in Accra time. */
export function formatTimestamp(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(iso);
  const date = todayIn(timeZone, d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
  return `${formatDate(date)}, ${time}`;
}
