/**
 * app/api/ai/recommend/route.ts
 * =============================
 * Thin proxy: browser -> Next.js (server) -> FastAPI -> itinerary_engine.py.
 *
 * The browser never talks to FastAPI or Gemini directly, so no key is exposed.
 * Itinerary generation is slow (Supabase fetch + Gemini), so the
 * timeout is generous.
 */

import { NextRequest, NextResponse } from "next/server";

import { guardAiRequest, readBoundedJson, sanitizeText } from "../../../../lib/ai-route-guard";

const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 120_000;
const RATE_LIMIT = { max: 5, windowMs: 60_000 };
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: NextRequest) {
  const guard = await guardAiRequest(request, "recommend", RATE_LIMIT);
  if ("response" in guard) return guard.response;

  const parsed = await readBoundedJson(request, MAX_BODY_BYTES);
  if ("response" in parsed) return parsed.response;
  const body = (parsed.body && typeof parsed.body === "object" ? parsed.body : {}) as {
    query?: unknown;
    origin_city?: unknown;
  };

  const query = sanitizeText(body.query, 1000);
  if (!query) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }
  const originCity = sanitizeText(body.origin_city, 80) || "Sydney";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(`${NEXT_PUBLIC_API_URL}/ai/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        origin_city: originCity,
      }),
      signal: controller.signal,
    });

    // A 404 here means the configured API has no /ai/recommend route — a
    // gateway misconfiguration, not "your trip was not found". Relaying it
    // verbatim makes the two indistinguishable.
    if (upstream.status === 404) {
      return NextResponse.json(
        {
          error: "endpoint_unavailable",
          detail: `${NEXT_PUBLIC_API_URL} has no /ai/recommend route. Point NEXT_PUBLIC_API_URL at an API that serves it.`,
        },
        { status: 502 },
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted ? "itinerary_timeout" : "api_unreachable",
        detail: aborted
          ? `No response within ${TIMEOUT_MS / 1000}s`
          : "Could not reach the FastAPI service. Is it running?",
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
