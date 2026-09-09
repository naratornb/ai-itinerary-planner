# Wizard → Itinerary Engine → Package Mapping

## Goal

Define the data contract that turns AI wizard selections into a persisted travel package with real flight, hotel, and activity rows, so the editor opens on a populated itinerary instead of an empty draft. This document is the source of truth for the field mapping; the code in `apps/web/lib/ai/itinerary.ts` implements it.

## Flow

1. The wizard collects destination, vibes, duration, and season.
2. `buildItineraryQuery(selection)` renders those selections back into a sentence, because the engine parses natural language rather than structured input. Two engine quirks shape it:
   - it detects exactly one theme, so only the *first* vibe that maps to a theme keyword is sent;
   - it returns the first match in its own keyword dict order, not the order words appear in the query, so sending two themes silently loses the user's first pick.
   The word "budget" is never written into the query: it is checked before most other themes and would override the chosen vibe. A bare dollar amount is picked up instead.
3. `generateItinerary(selection)` POSTs the query to the `/api/ai/recommend` proxy (which owns its own 120s timeout) and returns the raw `ItineraryResponse`.
4. `wizardDraftToPackageInput(draft)` builds the base package metadata from the wizard alone.
5. `itineraryToPackageInput(base, res)` merges the engine output over that base and produces the `POST /packages` body, including `flights[]`, `hotels[]`, and `activities[]`.
6. The backend's `create_package` inserts the catalogue and join rows; the editor later renders them via `fetchOwnPackage` → `buildDaysFromPackage`.

## Field mapping

| Package input (`apps/api/app/packages/schemas.py`) | Engine field (`ItineraryResponse`) | Transformation |
|---|---|---|
| `origin_iata` / `destination_iata` (exactly 3 chars) | `flights[].origin` / `.destination` — e.g. "Sydney (SYD)" or a city name | extract `/\(([A-Z]{3})\)/`; else accept a bare `^[A-Z]{3}$`; else skip the flight |
| `airline`, `departure_datetime`, `arrival_datetime` | same names | passthrough |
| `cabin_class` | `cabin_class` | passthrough, nullable |
| `price_aud` (int) | `price_aud` (float) | `Math.round`, null when not finite |
| `hotel_name`, `city`, `room_type` | same names | passthrough |
| `check_in_date` / `check_out_date` (date) | `check_in` / `check_out` (string) | `.slice(0, 10)` |
| `star_rating` (int 1–5) | `star_rating` (float) | round, then clamp to 1–5; null when absent |
| `price_per_night_aud` (int) | `price_per_night_aud` (float) | `Math.round` |
| `activity_name` | `days[].activities[].activity_name` | passthrough |
| `activity_date` (required) | none on the activity — the parent `days[].date` | lift from the parent day, `.slice(0, 10)` |
| activity `city` | `days[].city` | falls back to the base `destination_city` |
| activity `description` | `notes` | rename |
| `duration_hours` | `duration_hours` | passthrough |
| package `title` | `trip.title` | engine value when non-empty, else base; always `.slice(0, 200)` (backend `max_length=200`) |
| package `description` | `description` | engine value when non-empty, else base |
| package `duration_days` | `trip.duration_days` | engine value when an integer ≥ 1, else base — then raised to at least the number of distinct activity dates, since the engine can return more dated days than `trip.duration_days` claims and the editor would squash the overflow onto its last day |
| package `base_price_aud` | `trip.total_cost_aud` | `Math.round` when a positive finite number, else base |

`destination_city`, `destination_country`, and `max_group_size` always come from the wizard base — the engine does not model them the same way.

## Skip rules

A component that is missing a field the backend requires is dropped, not sent: one invalid row must not 422 the whole package.

- **Flight** — needs an extractable origin *and* destination IATA, plus `airline` and both datetimes.
- **Hotel** — needs `hotel_name`, `city`, and both check-in/check-out dates that yield a 10-character `YYYY-MM-DD`.
- **Activity** — needs `activity_name` and a parent day with a usable date; an undated day drops all of its activities.

There is no city→IATA lookup table on the client. Resolving a free-text city to an airport code is a guess, and a wrong guess persists as a real flight row, so unresolvable flights are dropped instead.

## Non-goals

- **Day titles and stories are not persisted.** `TravelPackageCreate` has no `days` input; the editor shows "Day N". Add a backend `days` input later if it matters.
- **Group size and budget are not collected.** The engine accepts both through the query, but the wizard does not ask; the defaults (2 travellers, no budget) stand.
- **A build that finishes after the user navigates within the wizard still persists its package.** The wizard remembers the created id per setup fingerprint and reuses it on the next identical build instead of creating a twin.
- **No fallback to an empty draft on generation failure.** An error returns the user to the season step to retry. The engine already has its own deterministic fallback when the LLM fails, so an extra client-side one would only hide problems.
- **The `/api/ai/recommend` proxy stays.** It already handles the long timeout; the client does not call the API cross-origin.
