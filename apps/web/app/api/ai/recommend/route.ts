/**
 * app/api/ai/recommend/route.ts
 * =============================
 * Thin proxy: browser -> Next.js (server) -> Flask -> itinerary_engine.py.
 *
 * The browser never talks to Flask or Gemini directly, so no key is exposed.
 * Itinerary generation is slow (Supabase fetch + BM25 + Gemini), so the
 * timeout is generous.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";
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
    const upstream = await fetch(`${API_URL}/api/ai/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: body.query,
        origin_city: body.origin_city ?? "Sydney",
      }),
      signal: controller.signal,
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted ? "itinerary_timeout" : "flask_unreachable",
        detail: aborted
          ? `No response within ${TIMEOUT_MS / 1000}s`
          : "Could not reach the Flask API. Is it running?",
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
