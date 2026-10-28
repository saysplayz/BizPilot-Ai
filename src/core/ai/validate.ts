// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
/**
 * Output validation for AI answers: every money amount in the answer must
 * match a figure BizPilot calculated (a Fact) or one the user typed. The
 * model cannot invent financial figures without the user being warned.
 */
import type { Minor } from "../money";
import type { Fact } from "./facts";

const MONEY_MENTION =
  /(?:GH₵|GH¢|GHS|GHC|₵|¢)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(\s?[kK]\b)?|(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(?:cedis|GHS|GH₵)\b/g;

export interface MoneyMention {
  text: string;
  minor: Minor;
}

export function extractMoneyMentions(text: string): MoneyMention[] {
  const out: MoneyMention[] = [];
  for (const m of text.matchAll(MONEY_MENTION)) {
    const num = m[1] ?? m[3];
    if (!num) continue;
    const [whole, frac = ""] = num.replace(/,/g, "").split(".");
    let minor = Number(whole) * 100 + Number(frac.padEnd(2, "0") || "0");
    if (m[2]) minor *= 1000; // "GH₵2k"
    if (Number.isSafeInteger(minor)) out.push({ text: m[0].trim(), minor });
  }
  return out;
}

export interface AnswerCheck {
  ok: boolean;
  /** Money mentions that match no calculated figure. */
  unverified: MoneyMention[];
}

/**
 * @param allowed extra amounts the user typed in their question (e.g. "GH₵2,000 of stock").
 */
export function checkAnswerFigures(answer: string, facts: readonly Fact[], allowed: readonly Minor[] = []): AnswerCheck {
  const known = new Set<number>();
  for (const f of facts) {
    if (f.kind === "money" && typeof f.minor === "number") known.add(Math.abs(f.minor));
  }
  for (const a of allowed) known.add(Math.abs(a));
  const unverified = extractMoneyMentions(answer).filter((m) => !known.has(Math.abs(m.minor)));
  return { ok: unverified.length === 0, unverified };
}
