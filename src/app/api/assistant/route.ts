// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireBusiness } from "@/lib/context";
import { answerQuestion } from "@/lib/ai/orchestrator";
import type { HistoryTurn } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  message: z.string().trim().min(1, "Ask a question").max(1000, "Please keep questions under 1,000 characters"),
  conversationId: z.string().uuid().optional(),
});

/**
 * POST /api/assistant
 * Authenticated (Supabase session cookie), rate limited per user in Postgres,
 * scoped to the active business. Conversation history is stored per business
 * AND per user (RLS).
 */
export async function POST(request: NextRequest) {
  // Same-origin check (cookies are SameSite=Lax; this blocks cross-site form posts too).
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ctx;
  try {
    ctx = await requireBusiness();
  } catch {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const quota = await ctx.supabase.rpc("consume_ai_quota");
  if (quota.error) {
    console.error("[assistant.quota]", quota.error.message);
    return NextResponse.json({ error: "The assistant is unavailable right now." }, { status: 503 });
  }
  if (!(quota.data as { allowed: boolean }).allowed) {
    return NextResponse.json({ error: "You've asked a lot of questions this hour. Please try again a little later." }, { status: 429 });
  }

  // Load or create the conversation (RLS guarantees it belongs to this user + business).
  let conversationId = parsed.data.conversationId;
  let history: HistoryTurn[] = [];
  if (conversationId) {
    const { data: msgs, error } = await ctx.supabase
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .eq("business_id", ctx.business.id)
      .order("id", { ascending: false })
      .limit(8);
    if (error) conversationId = undefined;
    else history = ((msgs ?? []) as { role: "user" | "assistant"; content: string }[]).reverse().map((m) => ({ role: m.role, text: String(m.content) }));
  }
  if (!conversationId) {
    const { data, error } = await ctx.supabase
      .from("ai_conversations")
      .insert({ business_id: ctx.business.id, user_id: ctx.user.id, title: parsed.data.message.slice(0, 80) })
      .select("id")
      .single();
    if (error) {
      console.error("[assistant.conversation]", error.message);
      return NextResponse.json({ error: "Could not start a conversation." }, { status: 500 });
    }
    conversationId = data.id as string;
  }

  let answer;
  try {
    answer = await answerQuestion(ctx, parsed.data.message, history);
  } catch (err) {
    console.error("[assistant]", err);
    return NextResponse.json({ error: "Sorry, I couldn't work that out. Please try again.", conversationId }, { status: 500 });
  }

  const { error: saveError } = await ctx.supabase.from("ai_messages").insert([
    { business_id: ctx.business.id, conversation_id: conversationId, user_id: ctx.user.id, role: "user", content: parsed.data.message },
    {
      business_id: ctx.business.id,
      conversation_id: conversationId,
      user_id: ctx.user.id,
      role: "assistant",
      content: answer.answer,
      facts: answer.facts,
      warnings: answer.warnings,
      proposal: answer.proposal,
    },
  ]);
  if (saveError) console.error("[assistant.save]", saveError.message);

  return NextResponse.json({ conversationId, ...answer });
}
