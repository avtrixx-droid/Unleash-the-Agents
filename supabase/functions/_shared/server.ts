import "./runtime.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { hashEmbed } from "./matcher.ts";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-host-pin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}
export type Admin = ReturnType<typeof admin>;

// gte-small runs inside the Supabase edge runtime: free, no external API,
// attendee text never leaves the project.
let session: InstanceType<typeof Supabase.ai.Session> | null = null;
export async function embed(text: string): Promise<{ v: number[]; model: boolean }> {
  try {
    session ??= new Supabase.ai.Session("gte-small");
    const out = (await session.run(text, { mean_pool: true, normalize: true })) as number[];
    if (Array.isArray(out) && out.length === 384) return { v: out, model: true };
  } catch (e) {
    console.warn("embedding failed, using hash fallback", e);
  }
  return { v: Array.from(hashEmbed(text)), model: false };
}

export function parseVector(v: unknown): Float32Array | null {
  if (!v) return null;
  try {
    const arr = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(arr) && arr.length ? Float32Array.from(arr as number[]) : null;
  } catch {
    return null;
  }
}

export function clean(text: unknown, max: number): string {
  return String(text ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
