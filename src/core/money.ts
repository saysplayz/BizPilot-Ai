// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * Money arithmetic.
 *
 * All amounts are integer MINOR units (pesewas for GHS: 100 pesewas = GH₵1).
 * JavaScript numbers represent integers exactly up to 2^53 (≈ GH₵90 trillion),
 * so addition and subtraction of minor units are exact. The only operations
 * that can introduce fractions — percentages and ratios — go through
 * `mulRatio`, which uses BigInt and a single, explicit rounding rule
 * (half away from zero, matching PostgreSQL's numeric `round`).
 *
 * Never use floating-point cedi values for authoritative totals.
 */

export type Minor = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertMinor(value: number, label = "amount"): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a whole number of minor units`);
  }
  return value;
}

/** Sum minor amounts exactly. */
export function sumMinor(values: readonly Minor[]): Minor {
  let total = 0;
  for (const v of values) {
    total += assertMinor(v);
  }
  return assertMinor(total, "total");
}

/**
 * amount × numerator ÷ denominator, rounded half away from zero.
 * Exact for any safe-integer inputs (BigInt intermediate).
 */
export function mulRatio(amount: Minor, numerator: number, denominator: number): Minor {
  assertMinor(amount);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new MoneyError("Ratio must use whole numbers and a non-zero denominator");
  }
  let n = BigInt(amount) * BigInt(numerator);
  let d = BigInt(denominator);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const q = abs / d;
  const r = abs % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  const result = Number(negative ? -rounded : rounded);
  return assertMinor(result, "result");
}

/**
 * Apply a percentage change (e.g. -20 for "20% lower", 12.5 for "+12.5%").
 * Percentages are converted to basis points so 12.5% is exact.
 */
export function applyPercentChange(amount: Minor, percent: number): Minor {
  const basisPoints = Math.round(percent * 100);
  return mulRatio(amount, 10_000 + basisPoints, 10_000);
}

/** Percentage of `part` relative to `whole`, one decimal place; null if whole is 0. */
export function percentOf(part: Minor, whole: Minor): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

const MONEY_INPUT = /^\s*(?:GH₵|GHS|GH¢|₵|¢)?\s*([+-])?\s*(?:GH₵|GHS|GH¢|₵|¢)?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?\s*$/i;

/**
 * Parse user input such as "1,250", "1250.5", "GH₵ 1,250.50" into minor units.
 * Rejects more than two decimal places, letters and empty input.
 */
export function parseMoney(input: string, opts: { allowNegative?: boolean; allowZero?: boolean } = {}): Minor {
  const match = MONEY_INPUT.exec(input ?? "");
  if (!match || (match[2] === undefined && match[3] === undefined)) {
    throw new MoneyError("Enter an amount like 1,250.00");
  }
  const sign = match[1] === "-" ? -1 : 1;
  const whole = (match[2] ?? "0").replace(/,/g, "");
  const fraction = (match[3] ?? "").padEnd(2, "0");
  if (whole.length > 13) {
    throw new MoneyError("That amount is too large");
  }
  const minor = sign * (Number(whole) * 100 + Number(fraction || "0"));
  if (minor < 0 && !opts.allowNegative) {
    throw new MoneyError("Amount cannot be negative");
  }
  if (minor === 0 && !opts.allowZero) {
    throw new MoneyError("Amount must be greater than zero");
  }
  return assertMinor(minor === 0 ? 0 : minor);
}

/** Safe variant for forms: returns null instead of throwing. */
export function tryParseMoney(input: string, opts?: { allowNegative?: boolean; allowZero?: boolean }): Minor | null {
  try {
    return parseMoney(input, opts);
  } catch {
    return null;
  }
}

const CURRENCY_SYMBOL: Record<string, string> = { GHS: "GH₵", USD: "$", NGN: "₦", EUR: "€", GBP: "£" };

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface FormatMoneyOptions {
  currency?: string;
  /** Show "+" for positive amounts (useful for cash movements). */
  signed?: boolean;
  /** Drop ".00" for whole amounts in compact UI (charts, chips). */
  compact?: boolean;
}

/** Format minor units for display, e.g. 123450 → "GH₵1,234.50". Deterministic (no locale surprises). */
export function formatMoney(amount: Minor, opts: FormatMoneyOptions = {}): string {
  assertMinor(amount);
  const symbol = CURRENCY_SYMBOL[opts.currency ?? "GHS"] ?? `${opts.currency} `;
  const abs = Math.abs(amount);
  const whole = groupThousands(String(Math.trunc(abs / 100)));
  const cents = String(abs % 100).padStart(2, "0");
  const body = opts.compact && cents === "00" ? whole : `${whole}.${cents}`;
  const sign = amount < 0 ? "-" : opts.signed && amount > 0 ? "+" : "";
  return `${sign}${symbol}${body}`;
}

/** Short form for chart axes: GH₵1.2k, GH₵3.5m. */
export function formatMoneyShort(amount: Minor, currency = "GHS"): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const cedis = amount / 100;
  const abs = Math.abs(cedis);
  const sign = cedis < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}${symbol}${Math.round(abs)}`;
}

/** Minor units → plain decimal string for form inputs ("1250.50"). */
export function toInputValue(amount: Minor | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  const abs = Math.abs(amount);
  return `${amount < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
