# Relative (Date-Free) Reference Flights

Issue: #75 — support undated relative schedules when creating packages.

## Goal

Let a package store flights on a relative schedule (Day 1, 09:00) instead of fixed calendar datetimes, so one package can be reused across travel dates and departure airports. This document is the source of truth for the flight input/output contract change; `apps/api/app/packages/schemas.py` implements it and `apps/api/openapi.yaml` publishes it.

## Product semantics

A package is a reusable template. The flight a creator places in the builder is a **reference flight**: it defines the intended route and itinerary flow (which day, roughly what time), not a seat every buyer will take. Buyers later choose their real travel dates and departure airport and pick from available flights — that purchase-side flow is out of scope here.

The backend must never require the client to invent calendar dates for a template, and must never generate placeholder dates itself.

## Current state (develop, before this change)

Most of issue #75 has already landed via migrations `0013`–`0015` and the `save_package_details` RPC:

| Requirement from #75 | Status |
|---|---|
| Hotels: `check_in_day` / `check_out_day` without dates | Done — `HotelInput` accepts dates **or** days; the RPC derives `nights` |
| Activities: `day_number` + `start_time` without `activity_date` | Done — `ActivityInput` accepts date **or** `day_number` |
| Relative days validated against `duration_days`, actionable 422 | Done — RPC returns `SAVE_PRECONDITION_FAILED`, e.g. `flight day_number must be between 1 and duration_days` |
| Atomic save of metadata, days and components | Done — single RPC transaction for both create and update |
| Persist relative fields | Done — every component is stored whole in `package_*.details` (jsonb) |
| Submit does not depend on dates | Done — `submit_package` only counts components |
| **Flights without datetimes** | **Missing** — `FlightInput` requires `departure_datetime` / `arrival_datetime` and does not declare `departure_time`, `arrival_time`, `duration_minutes` |

The web client already sends date-free flights (`day_number`, `departure_time`, `arrival_time`, `duration_minutes`) from both the AI create path (`apps/web/lib/ai/itinerary.ts`) and the editor save path (`buildPackageUpdate` in `apps/web/lib/itinerary-builder.ts`). Any package whose itinerary contains a flight therefore fails `POST /packages` / `PUT /packages/{id}` with 422 (`flights.0.departure_datetime: Field required`). This is why AI-created packages for destinations with a resolvable flight (e.g. Tokyo, SYD→NRT) cannot be created.

## Decisions

1. **No migration.** Flight times live in the `package_flights.details` jsonb snapshot the RPC already writes. No native columns: nothing filters or sorts on flight times in SQL. Add columns only if that need appears.
2. **Either/or validation**, mirroring hotels and activities.
3. **No ordering check between clock times.** `departure_time` and `arrival_time` are local to different time zones (SYD 21:00 → NRT 06:00 next day is valid). `duration_minutes` carries elapsed time when known.
4. **Route stays required.** `origin_iata`, `destination_iata`, `airline` remain required: the reference flight still defines the route. Buyer-side airport substitution is a later feature.

## Contract: `FlightInput` (POST and PUT)

| Field | Type | Required | Notes |
|---|---|---|---|
| `origin_iata`, `destination_iata` | string, exactly 3 chars | yes | unchanged |
| `airline` | string | yes | unchanged |
| `departure_datetime`, `arrival_datetime` | ISO-8601 string | no (was yes) | legacy dated flights |
| `departure_time` | `HH:MM` (`_TIME_RE`) | no | **new**, local time at origin |
| `arrival_time` | `HH:MM` (`_TIME_RE`) | no | **new**, local time at destination |
| `duration_minutes` | int ≥ 1 | no | **new** |
| `day_number` | int ≥ 1 | no | unchanged; range vs `duration_days` checked by the RPC |
| all other fields | — | — | unchanged |

Validation (`FlightInput._validate`), in order:

1. Duplicate `media_ids` → 422 (unchanged).
2. If **either** datetime is supplied: **both** are required, both must parse, and `arrival_datetime > departure_datetime` (unchanged behaviour for dated flights). One datetime alone → 422 `flight requires both departure_datetime and arrival_datetime`.
3. Otherwise: `day_number` **and** `departure_time` are required. Missing → 422 `flight requires departure_datetime/arrival_datetime or day_number/departure_time`.

A flight may carry both a datetime pair and relative fields; both are stored.

`TravelPackageUpdate` reuses `FlightInput`, so `PUT /packages/{id}` gets the same rules with no further change.

## Contract: `FlightDetail` (creator and marketplace detail)

`FlightDetailOut` gains `departure_time`, `arrival_time`, `duration_minutes` (all nullable). `_flight_from_row` reads them from `details`; legacy catalog-backed rows (`details IS NULL`) return `null`. Both `GET /packages/{id}` and the marketplace detail go through `_to_detail`, so one change covers both.

## Files

| File | Change |
|---|---|
| `apps/api/app/packages/schemas.py` | `FlightInput`: datetimes optional, 3 new fields, either/or validator. `FlightDetailOut`: 3 new fields |
| `apps/api/app/packages/service.py` | `_flight_from_row`: return the 3 new fields from `details` |
| `apps/api/openapi.yaml` | `FlightInput.required` → `[origin_iata, destination_iata, airline]`; document the either/or rule and reference-flight semantics (replace the "not eligible for relative-day placeholders" text); add the 3 fields to `FlightInput` and `FlightDetail`; bump `info.version` 2.4.0 → 2.5.0 (additive, minor) |
| `apps/api/tests/test_packages.py` | tests below |

Not changed: Supabase migrations, the `save_package_details` / `submit_package` RPCs, the web client.

## Error handling

- Shape errors (missing either/or fields, bad `HH:MM`, `duration_minutes < 1`) → FastAPI 422 from Pydantic, before any write.
- Day-range errors → existing RPC 422 `SAVE_PRECONDITION_FAILED`; the transaction rolls back, so no partial package is left.

## Tests

1. Create with an undated flight (`day_number` + `departure_time` + `arrival_time` + `duration_minutes`), undated hotel and undated activity → 201; detail returns the flight's times and duration.
2. Create with a dated flight (both datetimes, no times) → 201 (backward compatibility).
3. Flight with neither a datetime pair nor `day_number` + `departure_time` → 422.
4. Flight with only `departure_datetime` → 422.
5. Flight with `departure_time: "9:00"` or `"25:00"` → 422.
Tests 1–5 go in `apps/api/tests/test_packages.py`. Flight `day_number` > `duration_days` → 422 `SAVE_PRECONDITION_FAILED` is already covered there; no new test.

## Related work

- PR #81 (`fix/ai-flight-gateway`) commit `3b99cf1` switches the web client back to sending flight datetimes. With this change that is unnecessary and contradicts the relative-schedule design; the engine changes in that PR are unaffected. Coordinate with the PR author to drop that commit.
- Out of scope: buyer date/airport selection and flight matching on the detail/purchase page; surfacing 422 details in the web UI (tracked separately per #75).
