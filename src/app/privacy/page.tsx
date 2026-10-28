// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-surface px-5 py-8">
      <article className="mx-auto max-w-2xl space-y-5 text-[15px] leading-relaxed text-ink-soft">
        <Logo />
        <h1 className="text-2xl font-semibold text-ink">Privacy notice</h1>
        <p className="text-sm text-ink-muted">Plain-language summary for the BizPilot AI MVP.</p>

        <section>
          <h2 className="font-semibold text-ink">What we store</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your account: name, email and a securely hashed password (handled by Supabase Auth).</li>
            <li>Your business records: sales, expenses, stock, customers and suppliers (names and optional phone numbers), bills, payments, planned payments and saved scenarios.</li>
            <li>An audit log of financial changes (who changed what, and when), so mistakes can be traced and corrected.</li>
            <li>Your questions to the AI assistant and its answers, visible only to you within your business.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-ink">Who can see it</h2>
          <p className="mt-2">
            Only people you add to your business. Every record is tied to a business and protected by database-level access rules, so other BizPilot users can never see your data.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-ink">How the AI assistant uses your data</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>BizPilot calculates the figures itself from your records. Only the summaries needed to answer your question (for example totals, dates and customer names) are sent to the AI provider configured for this installation (Google Gemini or Anthropic Claude) to be explained in plain language.</li>
            <li>Customer phone numbers, notes and your login details are never sent to the AI provider.</li>
            <li>The AI cannot save or change records. If it suggests one, you review and confirm it yourself.</li>
            <li>If the AI service is not configured, no data leaves BizPilot for AI purposes.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-semibold text-ink">Messages and payments</h2>
          <p className="mt-2">
            BizPilot does not send SMS/WhatsApp messages, and it is not connected to any bank or Mobile Money account. Payment methods you record (cash, MoMo, bank, card) are your own labels — BizPilot does not verify them.
          </p>
        </section>

        <section>
          <h2 className="font-semibold text-ink">Forecasts are estimates</h2>
          <p className="mt-2">Cash-flow forecasts and AI answers are estimates based on what you have recorded. They are not financial advice or guarantees.</p>
        </section>

        <section>
          <h2 className="font-semibold text-ink">Your choices</h2>
          <p className="mt-2">You can export your reports, correct records, and ask us to delete your account and business data.</p>
        </section>

        <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          Before a production launch in Ghana, this notice and the data practices behind it must be reviewed against the Data Protection Act, 2012 (Act 843) and registration requirements of the Data Protection Commission, and any financial-services obligations before adding regulated integrations (e.g. Mobile Money or bank connections).
        </p>
        <Link href="/" className="inline-block text-sm font-medium text-brand hover:underline">
          ← Back
        </Link>
      </article>
    </div>
  );
}
