// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import { z } from "zod";

/**
 * Environment configuration, validated once. Public values are safe for the
 * browser; server values must only be read from server code.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing"),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/** Values copied unchanged from .env.example are treated as "not configured". */
const PLACEHOLDER = /your-project-ref|your-anon-or-publishable-key|^xxx|changeme/i;

export function isPlaceholder(value: string | undefined): boolean {
  return !value || PLACEHOLDER.test(value);
}

function rawSupabase() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    // Supabase now calls this the "publishable" key; accept either name.
    key: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim(),
  };
}

/** Why Supabase is not usable yet, or null when it is configured. Shown on the login/sign-up pages. */
export function supabaseConfigProblem(): string | null {
  const { url, key } = rawSupabase();
  if (!url || !key) return "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set in .env.local.";
  if (isPlaceholder(url) || isPlaceholder(key)) return ".env.local still contains the example placeholder values for Supabase.";
  if (!z.string().url().safeParse(url).success) return "NEXT_PUBLIC_SUPABASE_URL in .env.local is not a valid URL.";
  return null;
}

let cachedPublic: PublicEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  const problem = supabaseConfigProblem();
  if (problem) throw new Error(`Supabase is not configured: ${problem} See README → Supabase setup.`);
  const { url, key } = rawSupabase();
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Supabase is not configured: ${parsed.error.issues.map((i) => i.message).join("; ")}. See README → Supabase setup.`);
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

// ---------------------------------------------------------------------------
// AI provider (server only)
// ---------------------------------------------------------------------------
export type AiProviderId = "gemini" | "anthropic";

export interface AiConfig {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  /** Gemini only: API base URL (defaults to the public Gemini API). */
  baseUrl?: string;
}

export const DEFAULT_MODELS: Record<AiProviderId, string> = {
  gemini: "gemini-3.8-flash",
  anthropic: "claude-sonnet-5-5",
};

const MODEL_PREFIX: Record<AiProviderId, RegExp> = { gemini: /^gemini-/i, anthropic: /^claude-/i };

/**
 * Which AI provider to use. AI_PROVIDER picks explicitly; otherwise Gemini is
 * used when GEMINI_API_KEY is set, then Anthropic when ANTHROPIC_API_KEY is
 * set. Returns null when no key is configured (the assistant then uses its
 * built-in calculator).
 */
export function aiConfig(): AiConfig | null {
  const keys: Record<AiProviderId, string | undefined> = {
    gemini: (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim() || undefined,
    anthropic: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  };
  const wanted = process.env.AI_PROVIDER?.trim().toLowerCase();
  let provider: AiProviderId | null = null;
  if (wanted === "gemini" || wanted === "anthropic") provider = keys[wanted] ? wanted : null;
  else provider = keys.gemini ? "gemini" : keys.anthropic ? "anthropic" : null;
  if (!provider) return null;

  const apiKey = keys[provider]!;
  if (isPlaceholder(apiKey)) return null;
  const requested = process.env.AI_MODEL?.trim();
  // Ignore a model name meant for the other provider (e.g. an old AI_MODEL=claude-… with a Gemini key).
  const model = requested && MODEL_PREFIX[provider].test(requested) ? requested : DEFAULT_MODELS[provider];
  const baseUrl = provider === "gemini" ? process.env.GEMINI_API_BASE?.trim() || undefined : undefined;
  return { provider, apiKey, model, baseUrl };
}

export const AI_PROVIDER_LABEL: Record<AiProviderId, string> = { gemini: "Google Gemini", anthropic: "Anthropic Claude" };
