// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
/**
 * Pure helpers for the Google Gemini API (generateContent with function
 * calling). No network code here, so request building and response parsing
 * are unit-tested. The HTTP call lives in src/lib/ai/provider.ts.
 *
 * REST reference: POST {base}/models/{model}:generateContent with the key in
 * the `x-goog-api-key` header.
 */
import type { ToolDefinition } from "./prompt";

export const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  /** Opaque signature Gemini 3 models attach to parts; must be echoed back unchanged. */
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

/** Gemini's OpenAPI-style schema (subset). */
export interface GeminiSchema {
  type: "OBJECT" | "STRING" | "INTEGER" | "NUMBER" | "BOOLEAN" | "ARRAY";
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: GeminiSchema;
}

const TYPE_MAP: Record<string, GeminiSchema["type"]> = {
  object: "OBJECT",
  string: "STRING",
  integer: "INTEGER",
  number: "NUMBER",
  boolean: "BOOLEAN",
  array: "ARRAY",
};

/**
 * Convert our JSON-Schema tool parameters to Gemini's schema subset:
 * uppercase types, string-only enums (others are described in text),
 * no additionalProperties / exclusiveMinimum (described in text instead).
 */
export function toGeminiSchema(schema: Record<string, unknown>): GeminiSchema {
  const type = TYPE_MAP[String(schema.type ?? "string")] ?? "STRING";
  const out: GeminiSchema = { type };
  const notes: string[] = [];
  if (typeof schema.description === "string") notes.push(schema.description);

  if (Array.isArray(schema.enum)) {
    if (schema.enum.every((v) => typeof v === "string")) out.enum = schema.enum as string[];
    else notes.push(`Allowed values: ${schema.enum.join(", ")}.`);
  }
  if (typeof schema.minimum === "number") out.minimum = schema.minimum;
  if (typeof schema.maximum === "number") out.maximum = schema.maximum;
  if (typeof schema.exclusiveMinimum === "number") notes.push(`Must be greater than ${schema.exclusiveMinimum}.`);

  if (type === "OBJECT" && schema.properties && typeof schema.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
    if (Array.isArray(schema.required) && schema.required.length > 0) out.required = schema.required as string[];
  }
  if (type === "ARRAY" && schema.items && typeof schema.items === "object") {
    out.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }
  if (notes.length) out.description = notes.join(" ");
  return out;
}

export function toGeminiTools(tools: readonly ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => {
        const hasParams = Object.keys(t.input_schema.properties ?? {}).length > 0;
        return {
          name: t.name,
          description: t.description,
          // Tools without arguments omit `parameters` (an empty OBJECT is rejected by some models).
          ...(hasParams ? { parameters: toGeminiSchema(t.input_schema as unknown as Record<string, unknown>) } : {}),
        };
      }),
    },
  ];
}

/**
 * Build the conversation: prior turns (plain text) + the new question.
 * Gemini expects the first turn to be the user and roles to alternate, so
 * leading model turns are dropped and consecutive same-role turns merged.
 */
export function toGeminiHistory(history: readonly { role: "user" | "assistant"; text: string }[], question: string): GeminiContent[] {
  const turns = [...history.map((h) => ({ role: h.role === "assistant" ? ("model" as const) : ("user" as const), text: h.text })), { role: "user" as const, text: question }];
  const out: GeminiContent[] = [];
  for (const t of turns) {
    if (!t.text.trim()) continue;
    if (out.length === 0 && t.role === "model") continue;
    const last = out.at(-1);
    if (last && last.role === t.role) last.parts.push({ text: t.text });
    else out.push({ role: t.role, parts: [{ text: t.text }] });
  }
  return out;
}

export function buildGeminiRequest(args: { system: string; contents: GeminiContent[]; tools: readonly ToolDefinition[]; maxOutputTokens?: number }) {
  return {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: args.contents,
    tools: toGeminiTools(args.tools),
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { maxOutputTokens: args.maxOutputTokens ?? 2048, temperature: 0.2 },
  };
}

export interface ParsedGeminiReply {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  /** The model turn exactly as returned (including thought signatures) — append it to the conversation. */
  modelContent: GeminiContent | null;
  /** Set when Gemini returned no usable answer (blocked, empty, etc.). */
  problem: string | null;
}

export function parseGeminiResponse(json: unknown): ParsedGeminiReply {
  const body = (json ?? {}) as {
    candidates?: { content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (body.promptFeedback?.blockReason) {
    return { text: "", toolCalls: [], modelContent: null, problem: `blocked: ${body.promptFeedback.blockReason}` };
  }
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const reason = candidate?.finishReason;
  if (!candidate || (parts.length === 0 && reason && reason !== "STOP")) {
    return { text: "", toolCalls: [], modelContent: null, problem: `no answer (${reason ?? "empty response"})` };
  }
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text!)
    .join("")
    .trim();
  const toolCalls = parts
    .filter((p) => p.functionCall?.name)
    .map((p, i) => ({ id: p.functionCall!.id ?? `call_${i}`, name: p.functionCall!.name, input: (p.functionCall!.args ?? {}) as Record<string, unknown> }));
  return { text, toolCalls, modelContent: { role: "model", parts }, problem: null };
}

/** The user turn that answers the model's function calls (one part per call, in order). */
export function functionResponseContent(
  results: readonly { id: string; name: string; content: string; isError?: boolean }[],
  calls: readonly { id: string; name: string }[],
): GeminiContent {
  return {
    role: "user",
    parts: results.map((r) => {
      const call = calls.find((c) => c.id === r.id);
      let payload: Record<string, unknown>;
      if (r.isError) payload = { error: r.content };
      else {
        try {
          const parsed: unknown = JSON.parse(r.content);
          payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { result: parsed };
        } catch {
          payload = { result: r.content };
        }
      }
      // Only echo ids Gemini actually sent (synthetic "call_N" ids are ours).
      const id = call && !/^call_\d+$/.test(call.id) ? call.id : undefined;
      return { functionResponse: { ...(id ? { id } : {}), name: r.name, response: payload } };
    }),
  };
}
