// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
import type { Metadata } from "next";
import Link from "next/link";
import { AssistantChat, type ChatMessage } from "@/components/assistant/chat";
import { PageHeader } from "@/components/ui/card";
import type { Fact } from "@/core/ai/facts";
import { requireBusiness } from "@/lib/context";
import { aiConfig } from "@/lib/env";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string; new?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireBusiness();

  // Conversations are scoped by RLS to this user AND business.
  const { data: conversations } = await ctx.supabase
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("business_id", ctx.business.id)
    .eq("user_id", ctx.user.id)
    .order("updated_at", { ascending: false })
    .limit(10);

  const convos = (conversations ?? []) as { id: string; title: string }[];
  const activeId = sp.new ? undefined : (sp.c ?? convos[0]?.id);
  let initial: ChatMessage[] = [];
  if (activeId) {
    const { data } = await ctx.supabase
      .from("ai_messages")
      .select("role, content, facts, warnings, proposal")
      .eq("conversation_id", activeId)
      .eq("business_id", ctx.business.id)
      .order("id")
      .limit(50);
    type Row = { role: string; content: string; facts: unknown; warnings: unknown };
    initial = ((data ?? []) as Row[]).map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content),
      facts: (m.facts ?? []) as Fact[],
      warnings: (m.warnings ?? []) as string[],
      proposal: null, // old drafts are not re-offered; ask again to draft a new one
    }));
  }

  return (
    <>
      <PageHeader title="AI Assistant" description="Ask questions in plain language. Every figure comes from your records." />
      <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
        <AssistantChat key={activeId ?? "new"} aiConfigured={aiConfig() !== null} isDemo={ctx.business.is_demo} initialMessages={initial} initialConversationId={activeId} />
        <aside className="space-y-2 text-sm">
          <Link href="/assistant?new=1" className="block rounded-lg border border-line bg-surface px-3 py-2 font-medium text-brand hover:border-brand">
            + New conversation
          </Link>
          {((conversations ?? []) as { id: string; title: string }[]).map((c) => (
            <Link key={c.id} href={`/assistant?c=${c.id}`} className={`block truncate rounded-lg px-3 py-2 ${c.id === activeId ? "bg-brand-soft text-brand-strong" : "text-ink-soft hover:bg-surface"}`}>
              {c.title}
            </Link>
          ))}
        </aside>
      </div>
    </>
  );
}
