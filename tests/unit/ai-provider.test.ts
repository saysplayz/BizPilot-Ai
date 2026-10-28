// BizPilot AI · Part 3 — AI Assistant & Data Entry
// Owner: Member 3 (see TEAM.md)
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildGeminiRequest,
  functionResponseContent,
  parseGeminiResponse,
  toGeminiHistory,
  toGeminiSchema,
  toGeminiTools,
} from "../../src/core/ai/gemini";
import { TOOL_DEFINITIONS } from "../../src/core/ai/prompt";
import { aiConfig, supabaseConfigProblem } from "../../src/lib/env";

describe("Gemini tool schemas", () => {
  it("converts JSON Schema to Gemini's subset (uppercase types, no unsupported keywords)", () => {
    const s = toGeminiSchema({
      type: "object",
      properties: {
        amount_ghs: { type: "number", exclusiveMinimum: 0, description: "Amount in cedis" },
        horizon_days: { type: "integer", enum: [7, 14, 30] },
        period: { type: "string", enum: ["today", "this_month"] },
      },
      required: ["amount_ghs"],
      additionalProperties: false,
    });
    assert.equal(s.type, "OBJECT");
    assert.deepEqual(s.required, ["amount_ghs"]);
    assert.equal(s.properties!.amount_ghs!.type, "NUMBER");
    assert.match(s.properties!.amount_ghs!.description!, /greater than 0/);
    assert.equal(s.properties!.horizon_days!.enum, undefined, "non-string enums are described, not sent as enum");
    assert.match(s.properties!.horizon_days!.description!, /7, 14, 30/);
    assert.deepEqual(s.properties!.period!.enum, ["today", "this_month"]);
    assert.ok(!JSON.stringify(s).includes("additionalProperties"));
    assert.ok(!JSON.stringify(s).includes("exclusiveMinimum"));
  });

  it("declares every assistant tool; tools without arguments omit parameters", () => {
    const { functionDeclarations } = toGeminiTools(TOOL_DEFINITIONS)[0]!;
    assert.equal(functionDeclarations.length, TOOL_DEFINITIONS.length);
    const cash = functionDeclarations.find((f) => f.name === "get_cash_position")!;
    assert.ok(!("parameters" in cash));
    const spend = functionDeclarations.find((f) => f.name === "simulate_spend") as { parameters: { required: string[] } };
    assert.deepEqual(spend.parameters.required, ["amount_ghs", "day_offset"]);
  });
});

describe("Gemini conversation handling", () => {
  it("starts with the user, merges same-role turns and maps assistant → model", () => {
    const c = toGeminiHistory(
      [
        { role: "assistant", text: "orphan answer" },
        { role: "user", text: "How much cash?" },
        { role: "assistant", text: "GH₵3,000" },
        { role: "user", text: "first" },
      ],
      "second",
    );
    assert.deepEqual(c.map((x) => x.role), ["user", "model", "user"]);
    assert.equal(c[2]!.parts.length, 2);
  });

  it("builds a request with system instruction, tools and generation limits", () => {
    const req = buildGeminiRequest({ system: "rules", contents: toGeminiHistory([], "hi"), tools: TOOL_DEFINITIONS });
    assert.equal(req.systemInstruction.parts[0]!.text, "rules");
    assert.equal(req.contents[0]!.role, "user");
    assert.equal(req.toolConfig.functionCallingConfig.mode, "AUTO");
    assert.ok(req.generationConfig.maxOutputTokens > 0);
  });

  it("parses function calls, keeps thought signatures, ignores thought text", () => {
    const reply = parseGeminiResponse({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "thinking…", thought: true },
              { functionCall: { name: "simulate_spend", args: { amount_ghs: 2000, day_offset: 1 } }, thoughtSignature: "sig-123" },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });
    assert.equal(reply.problem, null);
    assert.equal(reply.text, "");
    assert.deepEqual(reply.toolCalls[0], { id: "call_0", name: "simulate_spend", input: { amount_ghs: 2000, day_offset: 1 } });
    assert.equal(reply.modelContent!.parts[1]!.thoughtSignature, "sig-123", "signature must be echoed back unchanged");
  });

  it("parses a final text answer", () => {
    const reply = parseGeminiResponse({ candidates: [{ content: { role: "model", parts: [{ text: "You have " }, { text: "GH₵3,000.00." }] }, finishReason: "STOP" }] });
    assert.equal(reply.text, "You have GH₵3,000.00.");
    assert.equal(reply.toolCalls.length, 0);
  });

  it("reports blocked or empty responses instead of inventing an answer", () => {
    assert.match(parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }).problem!, /SAFETY/);
    assert.match(parseGeminiResponse({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }).problem!, /MAX_TOKENS/);
    assert.ok(parseGeminiResponse({}).problem);
  });

  it("answers each function call with an object response; errors are explicit", () => {
    const calls = [
      { id: "call_0", name: "get_cash_position" },
      { id: "fc-abc", name: "get_low_stock" },
    ];
    const content = functionResponseContent(
      [
        { id: "call_0", name: "get_cash_position", content: JSON.stringify({ result: { cash_minor: 300000 }, data_gaps: [] }) },
        { id: "fc-abc", name: "get_low_stock", content: "This calculation failed.", isError: true },
      ],
      calls,
    );
    assert.equal(content.role, "user");
    const [a, b] = content.parts;
    assert.deepEqual(a!.functionResponse, { name: "get_cash_position", response: { result: { cash_minor: 300000 }, data_gaps: [] } });
    assert.deepEqual(b!.functionResponse, { id: "fc-abc", name: "get_low_stock", response: { error: "This calculation failed." } });
  });
});

describe("configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
  const clearAi = () => {
    for (const k of ["AI_PROVIDER", "AI_MODEL", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_BASE"]) delete process.env[k];
  };

  it("uses Gemini when GEMINI_API_KEY is set, with the default Gemini model", () => {
    clearAi();
    process.env.GEMINI_API_KEY = "AQ.test-key-1234567890";
    process.env.AI_MODEL = "claude-sonnet-5-5"; // stale value from an old .env must not be sent to Gemini
    const c = aiConfig()!;
    assert.equal(c.provider, "gemini");
    assert.equal(c.model, "gemini-3.8-flash");
    assert.equal(c.apiKey, "AQ.test-key-1234567890");
  });

  it("honours AI_PROVIDER and a matching AI_MODEL; returns null without a usable key", () => {
    clearAi();
    process.env.GEMINI_API_KEY = "AQ.g";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "claude-opus-5-5";
    assert.deepEqual(aiConfig(), { provider: "anthropic", apiKey: "sk-ant-x", model: "claude-opus-5-5", baseUrl: undefined });
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_MODEL = "gemini-3.6-flash";
    assert.equal(aiConfig()!.model, "gemini-3.6-flash");
    clearAi();
    assert.equal(aiConfig(), null);
  });

  it("treats Supabase placeholders from .env.example as not configured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://your-project-ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "your-anon-or-publishable-key";
    assert.match(supabaseConfigProblem()!, /placeholder/);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    assert.match(supabaseConfigProblem()!, /not set/);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefgh.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_abcdefghijklmnopqrstuvwxyz";
    assert.equal(supabaseConfigProblem(), null);
  });
});
