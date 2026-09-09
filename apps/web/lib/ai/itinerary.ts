/**
 * lib/ai/itinerary.ts
 * ===================
 * Translation layer between the AI wizard, itinerary_engine.py, and the editor.
 *
 *   AIWizardScreen state  --buildItineraryQuery-->  free-text query
 *   free-text query       --POST /api/ai/recommend-->  engine JSON
 *   engine JSON           --itineraryToPackageInput-->  POST /packages body
 *
 * The engine parses a natural-language string, so the wizard's structured
 * selections have to be rendered back into a sentence it can read.
 */

import type {
  ActivityInput,
  CreatePackageInput,
  FlightInput,
  HotelInput,
  PackageDayInput,
} from "../creator-api";

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
  address?: string;          // district + city; blank when inventory has none
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

const DURATION_TO_DAYS: Record<string, number> = { short: 4, mid: 7, long: 12 };

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

// ─── Engine response → POST /packages body ────────────────────────────────────

/** "Sydney (SYD)" → "SYD"; a bare "SYD" → "SYD"; anything else → null. */
function iataOf(place: string | undefined): string | null {
  const value = (place ?? "").trim();
  const parenthesised = /\(([A-Z]{3})\)/.exec(value);
  if (parenthesised) return parenthesised[1];
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

/** "2026-03-01T09:00:00" → "2026-03-01"; anything shorter than a date → null. */
function dateOf(value: string | undefined): string | null {
  const day = (value ?? "").slice(0, 10);
  return day.length === 10 ? day : null;
}

const roundOrNull = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;

/**
 * Merge the engine's itinerary into the wizard's base package input.
 * Components missing a field the backend requires are skipped rather than sent
 * (a 422 would lose the whole package for one bad row).
 */
export function itineraryToPackageInput(
  base: CreatePackageInput,
  res: ItineraryResponse,
): CreatePackageInput {
  const flights: FlightInput[] = [];
  for (const flight of res.flights ?? []) {
    const origin = iataOf(flight.origin);
    const destination = iataOf(flight.destination);
    // ponytail: the engine sends free text ("Sydney (SYD)" or a city name); no
    // city→IATA table here — a flight we can't resolve is dropped, not guessed.
    if (!origin || !destination) continue;
    if (!flight.airline || !flight.departure_datetime || !flight.arrival_datetime) continue;
    flights.push({
      origin_iata: origin,
      destination_iata: destination,
      airline: flight.airline,
      departure_datetime: flight.departure_datetime,
      arrival_datetime: flight.arrival_datetime,
      cabin_class: flight.cabin_class ?? null,
      price_aud: roundOrNull(flight.price_aud),
    });
  }

  const hotels: HotelInput[] = [];
  for (const hotel of res.accommodation ?? []) {
    const checkIn = dateOf(hotel.check_in);
    const checkOut = dateOf(hotel.check_out);
    if (!hotel.hotel_name || !hotel.city || !checkIn || !checkOut) continue;
    const stars = roundOrNull(hotel.star_rating);
    hotels.push({
      hotel_name: hotel.hotel_name,
      star_rating: stars === null ? null : Math.min(5, Math.max(1, stars)),
      city: hotel.city,
      check_in_date: checkIn,
      check_out_date: checkOut,
      price_per_night_aud: roundOrNull(hotel.price_per_night_aud),
      room_type: hotel.room_type ?? null,
    });
  }

  const activities: ActivityInput[] = [];
  const days: PackageDayInput[] = [];
  for (const [index, day] of (res.days ?? []).entries()) {
    // Day titles/summaries persist even when the day has no usable date —
    // they're independent of the activity rows below.
    if (day.title || day.description) {
      days.push({
        // Position, not the engine's day_number: a 0/negative value 422s and a
        // duplicate violates UNIQUE(package_id, day_number), killing the create.
        day_number: index + 1,
        title: day.title || null,
        summary: day.description || null,
      });
    }
    const activityDate = dateOf(day.date);
    if (!activityDate) continue;             // activities carry no date of their own
    for (const activity of day.activities ?? []) {
      if (!activity.activity_name) continue;
      activities.push({
        activity_name: activity.activity_name,
        activity_date: activityDate,
        city: day.city || base.destination_city,
        duration_hours: Number.isFinite(activity.duration_hours) ? activity.duration_hours : null,
        price_aud: roundOrNull(activity.price_aud),
        description: activity.notes ?? null,
      });
    }
  }

  const totalCost = res.trip?.total_cost_aud;
  const engineDuration = res.trip?.duration_days;
  // The engine can return more dated days than trip.duration_days claims (it
  // records the mismatch in validation.errors and returns anyway); a too-small
  // duration makes the editor squash the overflow onto its last day.
  const duration = Math.max(
    Number.isInteger(engineDuration) && (engineDuration as number) >= 1
      ? (engineDuration as number)
      : base.duration_days,
    new Set(activities.map((a) => a.activity_date)).size,
  );
  return {
    ...base,
    title: (res.trip?.title || base.title).slice(0, 200),
    description: res.description || base.description,
    duration_days: duration,
    base_price_aud:
      typeof totalCost === "number" && Number.isFinite(totalCost) && totalCost > 0
        ? Math.round(totalCost)
        : base.base_price_aud,
    flights,
    hotels,
    activities,
    days,
  };
}

// ─── Client call ──────────────────────────────────────────────────────────────

export async function generateItinerary(
  selection: WizardSelection,
  originCity = "Sydney",
): Promise<ItineraryResponse> {
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
    const friendly: Record<string, string> = {
      itinerary_timeout: "The AI took too long to respond. Please try again.",
      api_unreachable: "Could not reach the AI service. Please try again.",
      endpoint_unavailable: "The AI service is unavailable right now. Please try again later.",
    };
    throw new Error(
      friendly[detail?.error as string] ?? `Itinerary request failed (${response.status})`,
    );
  }

  return (await response.json()) as ItineraryResponse;
}
