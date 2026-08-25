/**
 * lib/ai/itinerary.ts
 * ===================
 * Translation layer between the AI wizard, itinerary_engine.py, and the editor.
 *
 *   AIWizardScreen state  --buildItineraryQuery-->  free-text query
 *   free-text query       --POST /api/ai/recommend-->  engine JSON
 *   engine JSON           --mapItineraryToEditor-->  editor state
 *
 * The engine parses a natural-language string, so the wizard's structured
 * selections have to be rendered back into a sentence it can read.
 */

// ─── Wizard input ─────────────────────────────────────────────────────────────

export type WizardSelection = {
  destination: string;                       // "Tokyo, Japan" or free text
  vibes: string[];                           // VIBES ids: chill|adventure|luxury|local|foodie|scenic
  duration: "short" | "mid" | "long" | "custom" | null;
  customDurationDays: number;
  season: string | null;                     // spring|summer|autumn|winter
  groupSize?: number;                        // defaults to 2
  budgetAud?: number | null;                 // optional
};

// ─── Engine response ──────────────────────────────────────────────────────────

export type EngineFlight = {
  flight_id: string; leg: string; airline: string;
  origin: string; destination: string;
  departure_datetime: string; arrival_datetime: string;
  cabin_class: string; price_aud: number;
};

export type EngineHotel = {
  hotel_id: string; hotel_name: string; city: string;
  star_rating: number; room_type: string;
  price_per_night_aud: number; nights: number; total_price_aud: number;
  check_in: string; check_out: string; amenities: string;
};

export type EngineActivity = {
  activity_id: string; activity_name: string; category: string;
  start_time: string; duration_hours: number;
  price_aud: number; rating: number; notes: string;
};

export type EngineDay = {
  day_number: number; date: string; city: string;
  title: string; description: string;
  activities: EngineActivity[];
};

export type ItineraryResponse = {
  meta: { trip_id: string; created_at: string; version: string };
  trip: {
    title: string; destination_cities: string[]; duration_days: number;
    theme: string; travel_dates: { depart_date: string; return_date: string };
    total_cost_aud: number; currency: string; group_size: number; status: string;
  };
  description: string;
  flights: EngineFlight[];
  accommodation: EngineHotel[];
  days: EngineDay[];
  budget_breakdown: {
    flights_aud: number; accommodation_aud: number; activities_aud: number;
    estimated_meals_aud: number; estimated_transport_aud: number; total_aud: number;
  };
  validation: { is_valid: boolean; warnings: string[]; errors: string[] };
};

// ─── Editor state ─────────────────────────────────────────────────────────────

export type EditorItem = {
  id: number;
  dayIndex: number;                          // which day tab this belongs to
  time: string;                              // "14:30"
  type: "FLIGHT" | "HOTEL" | "ACTIVITY";
  title: string;
  price: string;                             // "$850"
  icon: "plane" | "hotel" | "star";
  status: "critical" | "pass";
  category?: string;
  address?: string;
  duration?: string;                         // minutes, as a string
  notes?: string;
  sourceId?: string;                         // inventory id — proves it came from the DB
};

export type EditorDay = { day: number; count: number; title: string; meta: string };

export type EditorState = {
  packageTitle: string;
  days: EditorDay[];
  items: EditorItem[];
  selectedHotel: string;
  packagePrice: number;
  story: string;
  warnings: string[];
};

// ─── Wizard → query string ────────────────────────────────────────────────────

/**
 * VIBES ids -> a word THEME_KEYWORDS in itinerary_engine.py actually matches.
 *
 * Two constraints from the engine:
 *   1. It detects ONE theme, not several.
 *   2. It returns the first match in THEME_KEYWORDS dict order
 *      (luxury, budget, adventure, romance, culture, food, family, beach...),
 *      NOT the order the words appear in the query.
 *
 * So sending "food and culture" yields theme=culture and the user's first
 * pick is lost. We therefore send only the first vibe that maps.
 *
 * "chill" and "scenic" have no counterpart theme — they map to null and the
 * engine falls back to its "culture" default.
 */
const VIBE_TO_KEYWORD: Record<string, string | null> = {
  chill:     null,          // no matching theme in the engine
  adventure: "adventure",
  luxury:    "luxury",
  local:     "culture",
  foodie:    "food",
  scenic:    null,          // no matching theme in the engine
};

const DURATION_TO_DAYS: Record<string, number> = { short: 4, mid: 7, long: 11 };

/** "Tokyo, Japan" → "Tokyo". The engine matches on city aliases. */
function cityOf(destination: string): string {
  return destination.split(",")[0]?.trim() ?? destination.trim();
}

export function buildItineraryQuery(selection: WizardSelection): string {
  const city = cityOf(selection.destination);
  const days =
    selection.duration === "custom"
      ? selection.customDurationDays
      : DURATION_TO_DAYS[selection.duration ?? "short"] ?? 5;

  // Only the first mapped vibe — see the note on VIBE_TO_KEYWORD.
  const theme = selection.vibes.map((v) => VIBE_TO_KEYWORD[v]).find(Boolean) ?? "";

  const parts = [
    `${days} day`,
    theme,
    `trip to ${city}`,
    `for ${selection.groupSize ?? 2} travellers`,
  ];

  if (selection.season) parts.push(`in ${selection.season}`);

  // NOTE: never write the word "budget" here. THEME_KEYWORDS checks "budget"
  // before most other themes, so it would override the user's chosen vibe.
  // A bare dollar amount is picked up by the parser's third regex.
  if (selection.budgetAud) parts.push(`$${selection.budgetAud} AUD`);

  return parts.filter(Boolean).join(" ");
}

// ─── Engine response → editor state ───────────────────────────────────────────

const money = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
const clockOf = (iso: string) => {
  const m = /T(\d{2}:\d{2})/.exec(iso ?? "");
  return m ? m[1] : "00:00";
};

export function mapItineraryToEditor(res: ItineraryResponse): EditorState {
  const items: EditorItem[] = [];
  let id = 1;

  const outbound = res.flights.find((f) => f.leg === "outbound");
  const inbound  = res.flights.find((f) => f.leg === "return");
  const hotel    = res.accommodation[0];
  const lastDay  = Math.max(0, (res.days?.length ?? 1) - 1);

  if (outbound) {
    items.push({
      id: id++, dayIndex: 0, time: clockOf(outbound.arrival_datetime),
      type: "FLIGHT", icon: "plane", status: "pass",
      title: `${outbound.airline} ${outbound.origin} to ${outbound.destination}`,
      price: money(outbound.price_aud),
      sourceId: outbound.flight_id,
    });
  }

  res.days?.forEach((day, dayIndex) => {
    day.activities?.forEach((act) => {
      items.push({
        id: id++, dayIndex,
        time: act.start_time,
        type: "ACTIVITY", icon: "star", status: "pass",
        title: act.activity_name,
        price: money(act.price_aud),
        category: act.category,
        duration: String(Math.round((act.duration_hours || 1) * 60)),
        notes: act.notes,
        sourceId: act.activity_id,          // AC-xxx-nnn — traceable to the DB
      });
    });
  });

  if (hotel) {
    items.push({
      id: id++, dayIndex: 0, time: "19:00",
      type: "HOTEL", icon: "hotel", status: "pass",
      title: `${hotel.hotel_name} (${hotel.nights} nights)`,
      price: money(hotel.total_price_aud),
      address: hotel.city,
      notes: hotel.amenities,
      sourceId: hotel.hotel_id,
    });
  }

  if (inbound) {
    items.push({
      id: id++, dayIndex: lastDay, time: clockOf(inbound.departure_datetime),
      type: "FLIGHT", icon: "plane", status: "pass",
      title: `${inbound.airline} ${inbound.origin} to ${inbound.destination}`,
      price: money(inbound.price_aud),
      sourceId: inbound.flight_id,
    });
  }

  const days: EditorDay[] = (res.days ?? []).map((day, i) => ({
    day: day.day_number ?? i + 1,
    count: items.filter((it) => it.dayIndex === i).length,
    title: day.title || `Day ${i + 1}`,
    meta: day.city ? `${day.city} · ${day.activities?.length ?? 0} stops` : "",
  }));

  return {
    packageTitle:  res.trip?.title ?? "Untitled package",
    days:          days.length ? days : [{ day: 1, count: items.length, title: "Day 1", meta: "" }],
    items,
    selectedHotel: hotel?.hotel_name ?? "",
    packagePrice:  Math.round(res.budget_breakdown?.total_aud ?? 0),
    story:         res.description ?? "",
    warnings:      res.validation?.warnings ?? [],
  };
}

// ─── Client call ──────────────────────────────────────────────────────────────

export async function generateItinerary(
  selection: WizardSelection,
  originCity = "Sydney",
): Promise<EditorState> {
  const response = await fetch("/api/ai/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: buildItineraryQuery(selection),
      origin_city: originCity,
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail?.error ?? `Itinerary request failed (${response.status})`);
  }

  return mapItineraryToEditor((await response.json()) as ItineraryResponse);
}
