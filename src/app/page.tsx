// BizPilot AI · Part 4 — Frontend & UI/UX
// Owner: Member 4 (see TEAM.md)
import { ArrowRight, CalendarClock, LineChart, ShieldCheck, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/layout/app-shell";
import { buttonClass } from "@/components/ui/button-styles";

const FEATURES = [
  { icon: LineChart, title: "Profit, not just sales", body: "See what you actually made after the cost of goods and expenses — in plain words, not accounting jargon." },
  { icon: Users, title: "Who owes you", body: "Track customers who buy on credit, see who is overdue, and send a reminder from your own WhatsApp." },
  { icon: CalendarClock, title: "Cash you'll have tomorrow", body: "A day-by-day forecast that warns you before rent, supplier bills or a big purchase leave you short." },
  { icon: Sparkles, title: "Ask before you spend", body: "“Can I afford GH₵2,000 of stock next week?” Get an answer based on your own records, with the figures shown." },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost")}>
            Log in
          </Link>
          <Link href="/signup" className={buttonClass("primary")}>
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:pt-16">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-strong">
            Built for small shops in Ghana
          </p>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-ink sm:text-5xl">
            Know your business today. <span className="text-brand">Understand your cash tomorrow.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-soft sm:text-lg">
            BizPilot records your sales, expenses, stock and customer debts, then forecasts your cash so you can see trouble coming — and test a decision before you make it.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClass("primary", "lg")}>
              Start free <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/signup?demo=1" className={buttonClass("secondary", "lg")}>
              Explore the demo shop
            </Link>
          </div>
        </section>

        <section className="border-y border-line bg-canvas">
          <div className="mx-auto grid max-w-6xl gap-4 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
                <Icon className="mb-3 size-5 text-brand" aria-hidden />
                <h2 className="font-semibold text-ink">{title}</h2>
                <p className="mt-1 text-sm text-ink-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-10 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand" aria-hidden /> Your records are private to your business. Forecasts are estimates, never guarantees.
          </p>
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            Privacy notice
          </Link>
        </section>
      </main>
    </div>
  );
}
