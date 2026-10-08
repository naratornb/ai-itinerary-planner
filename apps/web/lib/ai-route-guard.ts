import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// Shared protection for the /api/ai/* route handlers. They call paid LLM APIs,
// so every request must come from a signed-in user, stay under a per-user rate
// limit, and carry a bounded body. Error bodies carry a machine `error` code
// plus a human `message` for the UI.

export type VerifiedUser = { id: string };
export type TokenVerifier = (token: string) => Promise<VerifiedUser | null>;
export type RateLimit = { max: number; windowMs: number };

async function verifyWithSupabase(token: string): Promise<VerifiedUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id };
}

let verifier: TokenVerifier = verifyWithSupabase;

/** Test seam: swap the Supabase lookup. Call with no argument to restore it. */
export function setTokenVerifier(next?: TokenVerifier) {
  verifier = next ?? verifyWithSupabase;
}

// In-memory fixed window per user and route. Serverless instances each keep
// their own counters, so this caps abuse per instance rather than globally.
const hits = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 5000;

/** Seconds until the caller may retry, or 0 when the request is allowed. */
export function checkRateLimit(key: string, limit: RateLimit, now = Date.now()): number {
  if (hits.size > MAX_TRACKED_KEYS) {
    for (const [trackedKey, stamps] of hits) {
      if (!stamps.some((stamp) => now - stamp < limit.windowMs)) hits.delete(trackedKey);
    }
  }
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < limit.windowMs);
  if (recent.length >= limit.max) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0] + limit.windowMs - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  return 0;
}

export function resetRateLimits() {
  hits.clear();
}

/** Returns the signed-in user, or the 401/429 response to send back. */
export async function guardAiRequest(
  req: NextRequest,
  route: string,
  limit: RateLimit,
): Promise<{ user: VerifiedUser } | { response: NextResponse }> {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  const user = token ? await verifier(token).catch(() => null) : null;
  if (!user) {
    return {
      response: NextResponse.json(
        { error: "unauthorized", message: "Please sign in again to use AI features." },
        { status: 401 },
      ),
    };
  }
  const retryAfter = checkRateLimit(`${route}:${user.id}`, limit);
  if (retryAfter) {
    return {
      response: NextResponse.json(
        { error: "rate_limited", message: `Too many AI requests. Try again in ${retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      ),
    };
  }
  return { user };
}

/** Reads a JSON body no larger than `maxBytes`, or the 400/413 response to send. */
export async function readBoundedJson(
  req: NextRequest,
  maxBytes: number,
): Promise<{ body: unknown } | { response: NextResponse }> {
  const declared = Number(req.headers.get("content-length"));
  const tooLarge = () => ({
    response: NextResponse.json(
      { error: "payload_too_large", message: "That request is too large." },
      { status: 413 },
    ),
  });
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) return tooLarge();
  try {
    return { body: JSON.parse(text) };
  } catch {
    return {
      response: NextResponse.json(
        { error: "invalid_json", message: "The request body is not valid JSON." },
        { status: 400 },
      ),
    };
  }
}

/** Single-line, control-character-free text capped at `max` characters. */
export function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
