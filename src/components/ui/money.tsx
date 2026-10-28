// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { formatMoney, type Minor } from "@/core/money";
import { cn } from "./cn";

/** Money display. Colour is optional and always paired with a sign. */
export function Money({
  value,
  currency = "GHS",
  signed,
  tone = "none",
  className,
}: {
  value: Minor;
  currency?: string;
  signed?: boolean;
  /** "auto" colours positive teal and negative red. */
  tone?: "none" | "auto" | "positive" | "negative";
  className?: string;
}) {
  const color =
    tone === "auto" ? (value < 0 ? "text-danger" : value > 0 ? "text-positive" : "") : tone === "positive" ? "text-positive" : tone === "negative" ? "text-danger" : "";
  return <span className={cn("tabular whitespace-nowrap", color, className)}>{formatMoney(value, { currency, signed })}</span>;
}
