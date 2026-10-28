// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
import "server-only";
import {
  buildGeminiRequest,
  functionResponseContent,
  GEMINI_DEFAULT_BASE,
  parseGeminiResponse,
  toGeminiHistory,
  type GeminiContent,
} from "@/core/ai/gemini";
import type { ToolDefinition } from "@/core/ai/prompt";
import type { AiConfig } from "@/lib/env";

/**
 * Provider-neutral chat with tool calling. The orchestrator only sees
 * ModelReply / ToolResult; each provider keeps its own native message
 * format internally (Anthropic content blocks, Gemini contents + thought
 * signatures), so adding a provider never touches the orchestration logic.
 */
export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
}

export interface ChatSession {
  /** First call: no results. Later calls: the results of the previous reply's tool calls. */
  send(results?: ToolResult[]): Promise<ModelReply>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

interface StartArgs {
  system: string;
  history: HistoryTurn[];
  question: string;
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export function startChat(config: AiConfig, args: StartArgs): ChatSession {
  return config.provider === "gemini" ? geminiSession(config, args) : anthropicSession(config, args);
}

/** Map an HTTP failure to an owner-friendly message; details go to the server log only. */
async function providerFailure(provider: string, res: Response): Promise<never> {
  // Never echo the provider's body to users (it may contain request details).
  const detail = await res.text().catch(() => "");
  console.error(`[ai:${provider}] HTTP`, res.status, detail.slice(0, 500));
  if (res.status === 429) throw new AiProviderError("The AI service is busy. Please try again in a minute.", 429);
  if (res.status === 401 || res.status === 403) throw new AiProviderError("The AI service rejected the API key. Check the key in your server settings.", res.status);
  if (res.status === 404) throw new AiProviderError("The configured AI model was not found. Check AI_MODEL in your server settings.", 404);
  throw new AiProviderError("The AI service could not answer right now.", res.status);
}

// ---------------------------------------------------------------------------
// Google Gemini (generateContent + function calling)
// ---------------------------------------------------------------------------
function geminiSession(config: AiConfig, args: StartArgs): ChatSession {
  const contents: GeminiContent[] = toGeminiHistory(args.history, args.question);
  let pendingCalls: ToolCall[] = [];
  const base = (config.baseUrl ?? GEMINI_DEFAULT_BASE).replace(/\/+$/, "");
  const url = `${base}/models/${encodeURIComponent(config.model)}:generateContent`;

  return {
    async send(results) {
      if (results?.length) contents.push(functionResponseContent(results, pendingCalls));
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
        body: JSON.stringify(buildGeminiRequest({ system: args.system, contents, tools: args.tools })),
        signal: args.signal,
        cache: "no-store",
      });
      if (!res.ok) await providerFailure("gemini", res);
      const parsed = parseGeminiResponse(await res.json());
      if (parsed.problem || !parsed.modelContent) {
        console.error("[ai:gemini]", parsed.problem);
        throw new AiProviderError("The AI service could not answer that question.");
      }
      contents.push(parsed.modelContent); // keeps thought signatures for the next round
      pendingCalls = parsed.toolCalls;
      return { text: parsed.text, toolCalls: parsed.toolCalls };
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic Messages API (tool use)
// ---------------------------------------------------------------------------
type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}

function anthropicSession(config: AiConfig, args: StartArgs): ChatSession {
  const messages: AnthropicMessage[] = [...args.history.map((h) => ({ role: h.role, content: h.text })), { role: "user", content: args.question }];
  return {
    async send(results) {
      if (results?.length) {
        messages.push({
          role: "user",
          content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
        });
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: config.model, max_tokens: 800, system: args.system, messages, tools: args.tools }),
        signal: args.signal,
        cache: "no-store",
      });
      if (!res.ok) await providerFailure("anthropic", res);
      const body = (await res.json()) as { content: AnthropicBlock[]; stop_reason: string };
      messages.push({ role: "assistant", content: body.content });
      const toolCalls =
        body.stop_reason === "tool_use"
          ? body.content.filter((b): b is Extract<AnthropicBlock, { type: "tool_use" }> => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }))
          : [];
      const text = body.content
        .filter((b): b is Extract<AnthropicBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text, toolCalls };
    },
  };
}
