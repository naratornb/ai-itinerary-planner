import assert from "node:assert/strict";
import test from "node:test";

import type { CreatePackageInput } from "../creator-api";
import {
  buildItineraryQuery,
  itineraryToPackageInput,
  type EngineActivity,
  type EngineDay,
  type EngineFlight,
  type EngineHotel,
  type ItineraryResponse,
  type WizardSelection,
} from "./itinerary";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const base = (overrides: Partial<CreatePackageInput> = {}): CreatePackageInput => ({
  title: "Base title",
  description: "Base description",
  destination_country: "Japan",
  destination_city: "Tokyo",
  duration_days: 4,
  base_price_aud: 100,
  ...overrides,
});

const flight = (overrides: Partial<EngineFlight> = {}): EngineFlight => ({
  flight_id: "FL-1",
  leg: "outbound",
  airline: "Test Air",
  origin: "Sydney (SYD)",
  destination: "Tokyo (HND)",
  departure_datetime: "2026-04-01T09:00:00",
  arrival_datetime: "2026-04-01T18:00:00",
  cabin_class: "economy",
  price_aud: 850.6,
  ...overrides,
});

const hotel = (overrides: Partial<EngineHotel> = {}): EngineHotel => ({
  hotel_id: "HT-1",
  hotel_name: "Hotel One",
  city: "Tokyo",
  star_rating: 4.2,
  room_type: "Deluxe",
  price_per_night_aud: 220.4,
  nights: 3,
  total_price_aud: 661.2,
  check_in: "2026-04-01T15:00:00",
  check_out: "2026-04-04T10:00:00",
  amenities: "wifi",
  ...overrides,
});

const activity = (overrides: Partial<EngineActivity> = {}): EngineActivity => ({
  activity_id: "AC-1",
  activity_name: "Sushi class",
  category: "food",
  start_time: "10:00",
  duration_hours: 2,
  price_aud: 99.5,
  rating: 4.5,
  notes: "Bring an appetite",
  ...overrides,
});

const day = (overrides: Partial<EngineDay> = {}): EngineDay => ({
  day_number: 1,
  date: "2026-04-01T00:00:00",
  city: "Tokyo",
  title: "Day one",
  description: "Arrival",
  activities: [activity()],
  ...overrides,
});

const response = (overrides: Partial<ItineraryResponse> = {}): ItineraryResponse => ({
  meta: { trip_id: "TR-1", created_at: "2026-01-01", version: "1" },
  trip: {
    title: "Engine title",
    destination_cities: ["Tokyo"],
    duration_days: 7,
    theme: "food",
    travel_dates: { depart_date: "2026-04-01", return_date: "2026-04-08" },
    total_cost_aud: 2500.4,
    currency: "AUD",
    group_size: 2,
    status: "draft",
  },
  description: "Engine description",
  flights: [flight()],
  accommodation: [hotel()],
  days: [day()],
  budget_breakdown: {
    flights_aud: 850,
    accommodation_aud: 661,
    activities_aud: 100,
    estimated_meals_aud: 0,
    estimated_transport_aud: 0,
    total_aud: 1611,
  },
  validation: { is_valid: true, warnings: [], errors: [] },
  ...overrides,
});

// ─── flights ──────────────────────────────────────────────────────────────────

test("extracts IATA codes from the \"City (XXX)\" form", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.equal(out.flights?.length, 1);
  assert.equal(out.flights?.[0].origin_iata, "SYD");
  assert.equal(out.flights?.[0].destination_iata, "HND");
});

test("accepts a bare three-letter IATA code", () => {
  const out = itineraryToPackageInput(
    base(),
    response({ flights: [flight({ origin: "SYD", destination: "HND" })] }),
  );
  assert.equal(out.flights?.[0].origin_iata, "SYD");
  assert.equal(out.flights?.[0].destination_iata, "HND");
});

test("skips a flight whose origin has no IATA code", () => {
  const out = itineraryToPackageInput(
    base(),
    response({ flights: [flight({ origin: "Sydney" }), flight({ flight_id: "FL-2" })] }),
  );
  assert.equal(out.flights?.length, 1);
  assert.equal(out.flights?.[0].origin_iata, "SYD");
});

test("skips a flight whose destination has no IATA code", () => {
  const out = itineraryToPackageInput(
    base(),
    response({ flights: [flight({ destination: "Tokyo" })] }),
  );
  assert.deepEqual(out.flights, []);
});

test("rounds flight price to an integer and carries airline and times", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.equal(out.flights?.[0].price_aud, 851);
  assert.equal(out.flights?.[0].airline, "Test Air");
  assert.equal(out.flights?.[0].departure_datetime, "2026-04-01T09:00:00");
  assert.equal(out.flights?.[0].arrival_datetime, "2026-04-01T18:00:00");
});

// ─── hotels ───────────────────────────────────────────────────────────────────

test("slices hotel ISO datetimes down to YYYY-MM-DD", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.equal(out.hotels?.length, 1);
  assert.equal(out.hotels?.[0].check_in_date, "2026-04-01");
  assert.equal(out.hotels?.[0].check_out_date, "2026-04-04");
  assert.equal(out.hotels?.[0].hotel_name, "Hotel One");
  assert.equal(out.hotels?.[0].city, "Tokyo");
});

test("skips a hotel with a missing check_out date", () => {
  const out = itineraryToPackageInput(
    base(),
    response({ accommodation: [hotel({ check_out: "" })] }),
  );
  assert.deepEqual(out.hotels, []);
});

test("skips a hotel whose date is shorter than YYYY-MM-DD", () => {
  const out = itineraryToPackageInput(
    base(),
    response({ accommodation: [hotel({ check_in: "2026-04" })] }),
  );
  assert.deepEqual(out.hotels, []);
});

test("clamps star rating into 1..5 after rounding", () => {
  const stars = (rating: number) =>
    itineraryToPackageInput(base(), response({ accommodation: [hotel({ star_rating: rating })] }))
      .hotels?.[0].star_rating;
  assert.equal(stars(5.7), 5);
  assert.equal(stars(0.4), 1);
  assert.equal(stars(4.2), 4);
});

test("rounds nightly price to an integer", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.equal(out.hotels?.[0].price_per_night_aud, 220);
});

// ─── activities ───────────────────────────────────────────────────────────────

test("lifts activity_date from the parent day date", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.equal(out.activities?.length, 1);
  assert.equal(out.activities?.[0].activity_date, "2026-04-01");
  assert.equal(out.activities?.[0].activity_name, "Sushi class");
  assert.equal(out.activities?.[0].city, "Tokyo");
});

test("skips activities under a day with an empty date", () => {
  const out = itineraryToPackageInput(
    base(),
    response({
      days: [day({ date: "" }), day({ day_number: 2, date: "2026-04-02", activities: [activity({ activity_id: "AC-2" })] })],
    }),
  );
  assert.equal(out.activities?.length, 1);
  assert.equal(out.activities?.[0].activity_date, "2026-04-02");
});

test("skips activities under a day whose date is too short", () => {
  const out = itineraryToPackageInput(base(), response({ days: [day({ date: "2026-04" })] }));
  assert.deepEqual(out.activities, []);
});

test("maps activity notes to description and rounds price", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.equal(out.activities?.[0].description, "Bring an appetite");
  assert.equal(out.activities?.[0].price_aud, 100);
  assert.equal(out.activities?.[0].duration_hours, 2);
});

// ─── days ─────────────────────────────────────────────────────────────────────

test("maps day title and description onto days rows", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.deepEqual(out.days, [
    { day_number: 1, title: "Day one", summary: "Arrival" },
  ]);
});

test("day_number falls back to the index when the engine omits it", () => {
  const out = itineraryToPackageInput(
    base(),
    response({
      days: [
        day({ day_number: undefined as unknown as number, title: "First" }),
        day({ day_number: undefined as unknown as number, title: "Second" }),
      ],
    }),
  );
  assert.deepEqual(out.days?.map((d) => d.day_number), [1, 2]);
});

test("position always wins over the engine's day_number — zero or duplicates can't 422/409 the create", () => {
  const out = itineraryToPackageInput(
    base(),
    response({
      days: [
        day({ day_number: 0, title: "First" }),
        day({ day_number: 0, title: "Second" }),
      ],
    }),
  );
  assert.deepEqual(out.days?.map((d) => d.day_number), [1, 2]);
});

test("a day with neither title nor description is skipped", () => {
  const out = itineraryToPackageInput(
    base(),
    response({
      days: [
        day({ day_number: 1, title: "", description: "" }),
        day({ day_number: 2, title: "", description: "Free day" }),
      ],
    }),
  );
  assert.deepEqual(out.days, [{ day_number: 2, title: null, summary: "Free day" }]);
});

test("an empty engine response yields no days", () => {
  assert.deepEqual(itineraryToPackageInput(base(), {} as ItineraryResponse).days, []);
});

// ─── metadata ─────────────────────────────────────────────────────────────────

test("engine metadata overrides the base package fields", () => {
  const out = itineraryToPackageInput(base(), response());
  assert.equal(out.title, "Engine title");
  assert.equal(out.description, "Engine description");
  assert.equal(out.duration_days, 7);
  assert.equal(out.base_price_aud, 2500);
});

test("falls back to base metadata when engine fields are empty or zero", () => {
  const res = response({ description: "" });
  res.trip.title = "";
  res.trip.duration_days = 0;
  res.trip.total_cost_aud = 0;
  const out = itineraryToPackageInput(base(), res);
  assert.equal(out.title, "Base title");
  assert.equal(out.description, "Base description");
  assert.equal(out.duration_days, 4);
  assert.equal(out.base_price_aud, 100);
});

test("keeps base fields the engine never supplies", () => {
  const out = itineraryToPackageInput(base({ max_group_size: 6 }), response());
  assert.equal(out.destination_city, "Tokyo");
  assert.equal(out.destination_country, "Japan");
  assert.equal(out.max_group_size, 6);
});

test("non-finite total cost falls back to the base price", () => {
  const res = response();
  res.trip.total_cost_aud = Number.NaN;
  assert.equal(itineraryToPackageInput(base(), res).base_price_aud, 100);
});

test("a fully empty engine response yields the base with empty components", () => {
  // The engine's models are extra=allow with every field optional — the
  // fallback path can omit any of trip/flights/accommodation/days.
  const out = itineraryToPackageInput(base(), {} as ItineraryResponse);
  assert.deepEqual(out.flights, []);
  assert.deepEqual(out.hotels, []);
  assert.deepEqual(out.activities, []);
  assert.equal(out.title, "Base title");
  assert.equal(out.description, "Base description");
  assert.equal(out.duration_days, 4);
  assert.equal(out.base_price_aud, 100);
});

test("duration grows to cover more dated days than the trip claims", () => {
  const res = response({
    days: [
      day({ date: "2026-04-01" }),
      day({ day_number: 2, date: "2026-04-02", activities: [activity({ activity_id: "AC-2" })] }),
      day({ day_number: 3, date: "2026-04-03", activities: [activity({ activity_id: "AC-3" })] }),
    ],
  });
  res.trip.duration_days = 2;
  assert.equal(itineraryToPackageInput(base({ duration_days: 1 }), res).duration_days, 3);
});

// ─── buildItineraryQuery ──────────────────────────────────────────────────────

const selection = (overrides: Partial<WizardSelection> = {}): WizardSelection => ({
  destination: "Tokyo, Japan",
  vibes: ["foodie"],
  duration: "short",
  customDurationDays: 5,
  season: null,
  ...overrides,
});

test("only the first mapped vibe reaches the query", () => {
  const query = buildItineraryQuery(selection({ vibes: ["chill", "foodie"] }));
  assert.ok(query.includes("food"));
  assert.ok(!query.includes("chill"));
});

test("unmapped vibes alone leave the theme out entirely", () => {
  const query = buildItineraryQuery(selection({ vibes: ["chill", "scenic"] }));
  assert.ok(!query.includes("chill"));
  assert.ok(!query.includes("scenic"));
  assert.ok(query.includes("trip to Tokyo"));
});

test("the first mapped vibe wins even when unmapped vibes precede it", () => {
  assert.ok(buildItineraryQuery(selection({ vibes: ["luxury", "foodie"] })).includes("luxury"));
  assert.ok(!buildItineraryQuery(selection({ vibes: ["luxury", "foodie"] })).includes("food"));
});

test("custom duration is rendered as \"<n> day\"", () => {
  const query = buildItineraryQuery(selection({ duration: "custom", customDurationDays: 9 }));
  assert.ok(query.startsWith("9 day"));
});

test("preset durations map to their day counts", () => {
  assert.ok(buildItineraryQuery(selection({ duration: "short" })).startsWith("4 day"));
  assert.ok(buildItineraryQuery(selection({ duration: "mid" })).startsWith("7 day"));
  assert.ok(buildItineraryQuery(selection({ duration: "long" })).startsWith("12 day"));
});

test("season and group size appear, and the word budget never does", () => {
  const query = buildItineraryQuery(
    selection({ season: "spring", groupSize: 3, budgetAud: 4000 }),
  );
  assert.ok(query.includes("for 3 travellers"));
  assert.ok(query.includes("in spring"));
  assert.ok(query.includes("$4000 AUD"));
  assert.ok(!query.includes("budget"));
});
