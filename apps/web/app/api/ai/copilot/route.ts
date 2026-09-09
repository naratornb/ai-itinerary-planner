/**
 * app/api/ai/copilot/route.ts
 * ===========================
 * Mock stand-in for the real Co-Pilot backend (H.2 Context-Aware Co-Pilot
 * spec — see docs/superpowers/specs/2026-09-02-mock-copilot-design.md).
 * No FastAPI endpoint exists yet, so this classifies the query with simple
 * keyword rules and returns deterministic CopilotResponseV1 bodies covering
 * every error_type. Replace this file with a proxy to FastAPI (same shape
 * as app/api/ai/recommend/route.ts) once /ai/copilot exists there.
 */

import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import type { CopilotResponseV1, CopilotSuggestionV1 } from "../../../../lib/copilot";

const CATALOG: CopilotSuggestionV1[] = [
  {
    item_id: "act-tokyo-food-01",
    item_name: "Tsukiji Outer Market Food Crawl",
    item_type: "activity",
    city: "Tokyo",
    country: "Japan",
    category: "Food",
    vibe: "Local, lively",
    best_season: "Spring",
    suitable_for: "Foodies",
    duration_hours: 3,
    price_aud: 85,
    rating: 4.7,
    why_recommended: "Matches your interest in food experiences in Tokyo.",
    verified: true,
    confidence: 0.92,
  },
  {
    item_id: "act-tokyo-food-02",
    item_name: "Shinjuku Izakaya Hopping Tour",
    item_type: "activity",
    city: "Tokyo",
    country: "Japan",
    category: "Food",
    vibe: "Nightlife",
    best_season: "Autumn",
    suitable_for: "Couples",
    duration_hours: 4,
    price_aud: 120,
    rating: 4.5,
    why_recommended: "A popular evening food option near your itinerary.",
    verified: true,
    confidence: 0.85,
  },
  {
    item_id: "act-bali-adventure-01",
    item_name: "Mount Batur Sunrise Trek",
    item_type: "activity",
    city: "Bali",
    country: "Indonesia",
    category: "Adventure",
    vibe: "Outdoors",
    best_season: "Dry season",
    suitable_for: "Adventurers",
    duration_hours: 6,
    price_aud: 65,
    rating: 4.8,
    why_recommended: "A top-rated adventurous activity for your trip.",
    verified: true,
    confidence: 0.9,
  },
];

// Cities the mock catalogue has no inventory for — used to demonstrate DB_GAP_ERROR.
const UNCOVERED_CITIES = ["paris", "rome", "seoul", "bangkok"];

function findCity(query: string): { known: string | null; uncovered: string | null } {
  const q = query.toLowerCase();
  const known = CATALOG.find((item) => q.includes(item.city.toLowerCase()))?.city ?? null;
  const uncovered = UNCOVERED_CITIES.find((city) => q.includes(city)) ?? null;
  return { known, uncovered };
}

export async function POST(request: NextRequest) {
  let body: { query?: string; session_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }

  const session_id = body.session_id ?? randomUUID();
  const base = {
    session_id,
    next_action: null,
    suggestions: [] as CopilotSuggestionV1[],
    auto_fill: { field: null, value: null },
    warnings: ["Demo data — the live Co-Pilot backend is not connected yet."],
  };

  if (query.toLowerCase().includes("more")) {
    const response: CopilotResponseV1 = {
      ...base,
      copilot_message: `Sure — the ${CATALOG[0].item_name} includes a certified local guide, a small group of up to 8, and hotel pickup.`,
      error_type: "DETAIL_REQUEST",
    };
    return NextResponse.json(response);
  }

  const { known, uncovered } = findCity(query);

  if (uncovered) {
    const response: CopilotResponseV1 = {
      ...base,
      copilot_message: `I don't have verified activities for ${uncovered[0].toUpperCase()}${uncovered.slice(1)} in the catalogue yet — try Tokyo or Bali instead.`,
      error_type: "DB_GAP_ERROR",
    };
    return NextResponse.json(response);
  }

  if (!known) {
    const response: CopilotResponseV1 = {
      ...base,
      copilot_message: "Which city are you travelling to? That'll help me find the right activity.",
      error_type: "HUMAN_INPUT_ERROR",
    };
    return NextResponse.json(response);
  }

  const matches = CATALOG.filter((item) => item.city === known);
  const response: CopilotResponseV1 = {
    ...base,
    copilot_message: `Here ${matches.length === 1 ? "is" : "are"} ${matches.length} ${matches.length === 1 ? "option" : "options"} in ${known}.`,
    error_type: null,
    suggestions: matches,
    next_action: { type: "add_suggestion", label: "Add to your day", reason: "These match your current day's theme." },
  };
  return NextResponse.json(response);
}
