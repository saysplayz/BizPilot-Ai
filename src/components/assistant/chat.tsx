// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
"use client";

import { AlertTriangle, Calculator, ChevronDown, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/feedback";
import type { Fact } from "@/core/ai/facts";
import { formatMoney, toInputValue } from "@/core/money";

interface Proposal {
  type: "expense" | "cash_sale" | "customer_payment";
  amount_minor: number;
  description: string;
  category?: string;
  customer_id?: string;
  customer_name?: string;
  date: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  facts?: Fact[];
  warnings?: string[];
  proposal?: Proposal | null;
  mode?: "ai" | "calculator";
}

const EXAMPLES = [
  "How much cash do I have right now?",
  "Can I afford to spend GH₵2,000 on stock tomorrow?",
  "Which customers owe me the most?",
  "Which bills should I prepare for?",
  "Which products need restocking?",
  "Why was my profit lower this month?",
  "What were my largest expenses?",
  "How does my saved scenario compare with my current forecast?",
];

function proposalHref(p: Proposal): string {
  const params = new URLSearchParams({ from: "assistant", amount: toInputValue(p.amount_minor), description: p.description, date: p.date });
  if (p.type === "expense") {
    params.set("type", "expense");
    if (p.category) params.set("category", p.category);
  } else if (p.type === "cash_sale") params.set("type", "sale");
  else {
    params.set("type", "payment");
    if (p.customer_id) params.set("customer", p.customer_id);
  }
  return `/transactions/new?${params.toString()}`;
}

export function AssistantChat({ aiConfigured, isDemo, initialMessages, initialConversationId }: { aiConfigured: boolean; isDemo: boolean; initialMessages: ChatMessage[]; initialConversationId?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q, conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The assistant could not answer.");
      setConversationId(data.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: data.answer, facts: data.facts, warnings: data.warnings, proposal: data.proposal, mode: data.mode }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setMessages((m) => m.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <div className="flex min-h-[60vh] flex-col rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      {!aiConfigured && (
        <div className="border-b border-line p-3">
          <Notice tone="info" title="AI explanations are not configured">
            Questions are answered by BizPilot&apos;s built-in calculator using your records. Add a <code>GEMINI_API_KEY</code> (or <code>ANTHROPIC_API_KEY</code>) to the server&apos;s <code>.env.local</code> and restart it to get conversational explanations.
          </Notice>
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Sparkles className="size-6" aria-hidden />
            </div>
            <h2 className="font-semibold">Ask about your business</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
              Answers use your own records{isDemo ? " (fictional demo data)" : ""}. Figures are calculated by BizPilot — the assistant explains them and shows you which figures it used.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border border-line bg-canvas px-3 py-1.5 text-left text-sm text-ink-soft hover:border-brand hover:text-ink">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[92%] rounded-2xl px-4 py-3 text-[15px] sm:max-w-[80%]", m.role === "user" ? "bg-brand text-white" : "border border-line bg-canvas/60 text-ink")}>
              {m.role === "assistant" && (
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  {m.mode === "calculator" ? <Calculator className="size-3" aria-hidden /> : <Sparkles className="size-3" aria-hidden />}
                  {m.mode === "calculator" ? "BizPilot calculator" : "BizPilot AI"}
                </p>
              )}
              <p className="whitespace-pre-wrap">{m.content}</p>

              {m.warnings && m.warnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.warnings.map((w, j) => (
                    <li key={j} className="flex gap-1.5 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {w}
                    </li>
                  ))}
                </ul>
              )}

              {m.proposal && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-info-soft p-3 text-sm">
                  <p className="font-medium text-info">Drafted — not saved</p>
                  <p className="text-ink-soft">
                    {m.proposal.type === "expense" ? "Expense" : m.proposal.type === "cash_sale" ? "Cash sale" : `Payment from ${m.proposal.customer_name}`}: {formatMoney(m.proposal.amount_minor)} — {m.proposal.description}
                  </p>
                  <Link href={proposalHref(m.proposal)} className={buttonClass("primary", "sm", "mt-2")}>
                    Review &amp; confirm
                  </Link>
                </div>
              )}

              {m.facts && m.facts.length > 0 && (
                <details className="group mt-2 text-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand">
                    <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden /> Figures used ({m.facts.length})
                  </summary>
                  <dl className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
                    {m.facts.map((f, j) => (
                      <div key={j} className="flex justify-between gap-3 px-3 py-1.5 text-xs">
                        <dt className="text-ink-soft">{f.label}</dt>
                        <dd className="tabular font-medium">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-line bg-canvas/60 px-4 py-3 text-sm text-ink-muted">
              <span className="inline-flex gap-1" aria-label="Working it out">
                <span className="size-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:-0.2s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:-0.1s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-ink-muted" />
              </span>{" "}
              Checking your records…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-line p-3">
        {error && (
          <p className="mb-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <label htmlFor="assistant-input" className="sr-only">
            Ask a question
          </label>
          <input
            id="assistant-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            placeholder="e.g. Can I afford to restock tomorrow?"
            className="h-11 flex-1 rounded-lg border border-line-strong px-3 text-[15px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !input.trim()} aria-label="Send">
            <Send className="size-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-muted">Answers are estimates from your records, not financial advice. The assistant can draft records but never saves them.</p>
      </form>
    </div>
  );
}
