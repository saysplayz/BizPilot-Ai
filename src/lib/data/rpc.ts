// BizPilot AI · Part 1 — Database & Security
// Owner: Member 1 (see TEAM.md)
import "server-only";
import type { SupabaseServerClient } from "@/lib/supabase/server";

/**
 * Typed wrapper for read RPCs. Reads throw (handled by route error
 * boundaries); writes use server actions that return friendly errors instead.
 */
export async function readRpc<T>(supabase: SupabaseServerClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[rpc:${fn}]`, error.code, error.message);
    throw new Error(`Could not load data (${fn}).`);
  }
  return data as T;
}

export function unwrap<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    console.error(`[query:${what}]`, result.error.code, result.error.message);
    throw new Error(`Could not load ${what}.`);
  }
  return (result.data ?? ([] as unknown)) as T;
}
