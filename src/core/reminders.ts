// BizPilot AI · Part 2 — Finance Engine & Testing
// Owner: Member 2 (see TEAM.md)
/**
 * Payment reminder drafts. BizPilot never sends messages itself: the owner
 * reviews the text and sends it from their own WhatsApp/SMS. No messaging
 * integration is configured in the MVP.
 */
import { formatDate, type IsoDate } from "./dates";
import { formatMoney, type Minor } from "./money";

export type ReminderTone = "friendly" | "firm";

export interface ReminderInput {
  businessName: string;
  customerName: string;
  amount: Minor;
  dueDate: IsoDate;
  daysOverdue: number;
  invoiceNumber?: string;
  tone?: ReminderTone;
  currency?: string;
}

export function buildReminderMessage(input: ReminderInput): string {
  const amount = formatMoney(input.amount, { currency: input.currency });
  const firstName = input.customerName.trim().split(/\s+/)[0] ?? input.customerName;
  const ref = input.invoiceNumber ? ` (${input.invoiceNumber})` : "";
  const due =
    input.daysOverdue > 0
      ? `which was due on ${formatDate(input.dueDate)}`
      : `which is due on ${formatDate(input.dueDate)}`;

  if ((input.tone ?? "friendly") === "firm") {
    return [
      `Hello ${firstName},`,
      `This is a reminder from ${input.businessName} that ${amount}${ref} ${due} is still outstanding.`,
      `Please arrange payment by Mobile Money, bank transfer or cash at the shop as soon as possible, or let us know when you can pay.`,
      `Thank you.`,
    ].join("\n\n");
  }
  return [
    `Hello ${firstName}, I hope you are well.`,
    `Just a gentle reminder from ${input.businessName} about ${amount}${ref} ${due}.`,
    `You can pay by Mobile Money or at the shop. Thank you for your business!`,
  ].join("\n\n");
}

/** Convert a Ghanaian phone number to international digits for wa.me links. */
export function toInternationalGhana(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  if (/^\+233\d{9}$/.test(digits)) return digits.slice(1);
  if (/^233\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  return null;
}

export function whatsappLink(phone: string, message: string): string | null {
  const intl = toInternationalGhana(phone);
  return intl ? `https://wa.me/${intl}?text=${encodeURIComponent(message)}` : null;
}

export function smsLink(phone: string, message: string): string {
  return `sms:${phone.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(message)}`;
}
