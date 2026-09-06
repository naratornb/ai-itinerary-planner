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

const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest) {
  let body: { query?: string; origin_city?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.query?.trim()) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(`${NEXT_PUBLIC_API_URL}/ai/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: body.query,
        origin_city: body.origin_city ?? "Sydney",
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
