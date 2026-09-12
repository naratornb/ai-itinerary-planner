# Frontend handover: save a complete package and submit for review

Date: 12 September 2026.

**Status.** Backend code for this feature (Tasks A-D of the package-save-submit
plan) is implemented and reviewed on this branch. **The database migration
(`supabase/migrations/0013_package_editor_persistence.sql`) has NOT been
deployed** — it has not been run against any Supabase project, staging or
production. Deployment happens separately through the repository's normal
migration pipeline. Until that migration runs, none of the behavior below is
live: the new columns, RPCs, and trigger do not exist in any real database.
This document is the FE integration contract to build against once
deployment happens; it is not a claim that the feature works end-to-end today.

Frontend source (`apps/web`) is unchanged by this backend slice. The FE work
described in "Frontend work after backend delivery" below is a follow-up task
for the frontend developer, not something this change implements.

## What was verified, and how

Everything database-level in this feature — the atomic save/submit
transactions, the row locks, the media-delete trigger, the save/submit race
fix, and ownership checks — was verified by **code review and desk-checking
of the SQL only**. No test database exists for this branch and the project's
rules forbid `supabase db push` / applying migrations to a remote database
outside the normal pipeline. Concretely:

- `apps/api/tests/package_editor_persistence.sql` is a runnable script for a
  human to execute against a real (e.g. local or staging) Postgres instance
  *after* the migration is deployed there. It has not been run as part of
  this task.
- The Python test suite below exercises the Pydantic schemas, the service
  layer's request-shaping logic (with `requests` stubbed), and the OpenAPI
  document itself. It never talks to Postgres.
- No database checks actually ran while producing this document.

## Goal

After editing a trip, a creator must be able to save it, reload it without
losing travel details, and submit exactly that saved itinerary for review.

## Endpoints and review flow

1. Create a draft with `POST /packages` if there is no package ID yet. It
   accepts the same detailed component fields as `PUT` (see below).
2. Upload files with `POST /media/upload` and retain the returned `media_id`.
   Wait for uploads to succeed before saving references to them.
3. Save edits using `PUT /packages/{package_id}`. Wait for a successful
   response before submitting.
4. Send `POST /packages/{package_id}/submit` with an optional body:

   ```json
   { "submission_note": "Ready for review." }
   ```

5. On HTTP 200, show the returned `pending_review` status and prevent further
   editing. This is submission, not publication.

All protected calls require `Authorization: Bearer <Supabase access token>`.
The optional submission note is limited to 500 characters.

Submission requires a draft or rejected package, at least one flight, one
hotel, one activity (counted by package row, so custom components with no
catalog ID still count), and `base_price_aud > 0`. It returns
`422 SUBMISSION_PRECONDITION_FAILED` with a `details.missing` array when those
conditions fail. An admin later calls `/approvals/{package_id}/approve` and
`/approvals/{package_id}/publish`; the creator's submit button must not call
those endpoints directly, and PUT/submit never make a package publicly live.

The submit endpoint does not accept or save editor content — it only reads
what was already saved. Sending `status` to PUT does not change the
lifecycle. FE validation must not replace the backend submission checks,
since the backend is authoritative and re-validates on every submit.

## Save semantics (implemented)

- `PUT /packages/{package_id}` partially updates metadata and replaces only
  the collections supplied in the request body; it returns the complete
  persisted detail.
- For `flights`, `hotels`, and `activities`: **omitting** the key leaves the
  package's stored collection unchanged; supplying an **array** (including
  `[]`) replaces that package's collection — `[]` deliberately clears it.
  Supplying an explicit JSON **`null`** for any of these three keys is
  rejected with `422 VALIDATION_ERROR` (schema-level, before the request
  reaches the RPC). A well-formed body that fails a save-time business rule
  (a `day_number` outside `1..duration_days`, a `media_ids` reference that
  doesn't belong to this package, etc.) is rejected with
  `422 SAVE_PRECONDITION_FAILED` instead — nothing is written either way, but
  FE should treat this as a distinct, still user-correctable case rather than
  a generic upstream failure. Collection replacement is always scoped to this
  one package.
- `days` is the one exception, kept for backward compatibility: `null` (or
  omitting the key) means no change; `[]` clears all day narratives. A
  supplied `days` array replaces rows by exact `day_number` — days need not
  be contiguous, and this is a fix for the previous trim-by-array-length
  behavior.
- A full collection replacement issues **new** `package_component_id` values
  in the response. Do not keep treating a previous response's IDs, or local
  editor timeline IDs, as still valid — always consume the fresh response.
- Save is one atomic transaction: any validation failure (day/hotel bounds,
  time format, duplicate day numbers, duplicate or foreign/missing media
  IDs, non-finite/negative numbers, flight timestamp ordering, etc.) rolls
  back the entire save; nothing is partially written.
- A network timeout, or a failed detail re-read immediately after a
  successful write, can leave the outcome uncertain from the client's
  perspective even though the database is either fully committed or fully
  rolled back. **The FE must reload/reconcile with a fresh `GET` before
  retrying a save or calling submit** — a failed HTTP response is not proof
  the write was rolled back, and a missing HTTP response is not proof it
  wasn't committed.
- Save is last-writer-wins across separate editor sessions/tabs. There is no
  versioning, ETag, or collaboration protocol in this slice. The FE is
  responsible for awaiting its own successful save and blocking further
  local edits while its own submit sequence is in flight — the backend
  cannot detect edits that were never sent to it, from this tab or any
  other.

## Field mapping (implemented, verified against `apps/api/app/packages/schemas.py`)

| FE domain value | API field | Notes |
| --- | --- | --- |
| Package title, description, destination, duration, group size, tags | Existing metadata fields | Unchanged |
| Package price | `base_price_aud` | Whole AUD integer, never a formatted string |
| Day story | `days[].summary` | Maps from `BuilderDay.story` |
| Day subtitle/vibe | `days[].meta` | New field; persisted verbatim, not derived |
| Day photos | `days[].media_ids` | Ordered array of uploaded media UUIDs, unique within the day |
| Flights | `flights[]`: `origin_iata`, `destination_iata`, `airline`, `flight_number`, `departure_datetime`, `arrival_datetime`, `cabin_class`, `price_aud`, plus new `day_number`, `sequence_order`, `notes`, `media_ids`, `source_id` | `departure_datetime`/`arrival_datetime` remain real timestamps — never replace them with the editor's formatted arrival label |
| Hotel stays | `hotels[]`: `hotel_name`, `star_rating`, `city`, `address`, `price_per_night_aud`, `room_type`, plus new `check_in_day`/`check_out_day` (or existing `check_in_date`/`check_out_date`), `sequence_order`, `notes`, `media_ids`, `source_id` | **One `HotelInput` = one full stay.** Repeated nightly rows and the check-out marker in the editor timeline are renderings of that one stay, not extra bookings — deduplicate by stay identity before sending |
| Activities / creator picks | `activities[]`: `activity_name`, `activity_date` or `day_number`, `city`, plus new `sequence_order`, `start_time`, `category`, `address`, `notes`, `media_ids`, `source_id` | `start_time` is `HH:MM`; convert the editor's minutes-based duration to `duration_hours` as a float |
| Item notes | Component `notes` | Independent from `description`; do not merge them |
| Item photos | Component `media_ids` | Must be already-uploaded media IDs belonging to this package — never blob/object/preview URLs |
| Co-Pilot provenance | Component `source_id` | Provenance only; never treated as permission to read/modify shared inventory |
| Component output extra | `package_component_id` | Identifies the real package row; catalog IDs (`flight_id`/`hotel_id`/`activity_id`) are nullable and not required for custom items |
| UI icon, formatted price, validation highlights, modal state, generated hotel marker labels | No stored field | Recompute client-side from persisted domain data |

### Undated / relative placement

- Activities may omit `activity_date` when `day_number` is supplied instead.
  Existing date-based activities keep working unchanged.
- Hotels may omit both `check_in_date`/`check_out_date` when valid
  `check_in_day`/`check_out_day` are supplied instead (both of a pair are
  required together). `check_out_day` may equal `duration_days + 1` (the
  departure boundary).
- Flights still always require real `departure_datetime`/`arrival_datetime`
  in the existing format — there is no undated flight placeholder.
- Relative day fields are bounded: `1 <= day_number <= duration_days` for
  flights/activities/hotel check-in; hotel check-out is
  `2 <= check_out_day <= duration_days + 1` and must be after check-in. These
  bounds are checked against the **final merged package** on every save,
  including components the request left unchanged — so shrinking
  `duration_days` can fail even if you didn't touch flights/activities in
  that same request.

### Ordering — the cross-type tie-break is the FE's responsibility

The backend returns three **separate** collections (`flights`, `hotels`,
`activities`) plus `days`, each internally ordered by `day_number` then
`sequence_order` (server-side fallback when `sequence_order` is null: array
position, then legacy rows keep their existing fallback). The backend's
contract stops at "deterministic ordering within each collection, keyed by
`day_number` + `sequence_order`." **Interleaving flights/hotels/activities
into one per-day timeline, and deciding the tie-break when two items land on
the same day with no `sequence_order`, is the FE's rendering concern** — the
API does not attempt to hand back one pre-interleaved list. When you need a
deterministic FE-side tie-break, fall back to component type then
`package_component_id`, matching the legacy behavior for items without
positions.

`sequence_order` on a **hotel** round-trips through the saved `details`
snapshot on that stay, but it is not a native database ordering column the
way flight/activity `sequence_order` values are. Do not build any FE feature
that depends on the database itself ordering hotels by position — treat
returned hotel order as save order / array index unless you also carry
`sequence_order` client-side.

## A full example: flights + a multi-night hotel stay

This is a `PUT` request body, verified against the implemented
`TravelPackageUpdate`/`FlightInput`/`HotelInput`/`ActivityInput`/
`PackageDayInput` models in `apps/api/app/packages/schemas.py` (see
`test_handover_example_payload_validates_against_travel_package_update` in
`apps/api/tests/test_package_editor_contract.py`, which parses this exact
block and validates it). It supplies `flights` and `hotels` as full
replacements (this is a **complete** update, unlike the partial example
below) — a `[]` was not used because there is content to send.

```json
{
  "title": "Tokyo food and culture week",
  "description": "A week exploring Tokyo's neighbourhoods, markets and food scenes.",
  "base_price_aud": 3200,
  "duration_days": 4,
  "days": [
    { "day_number": 1, "title": "Arrival", "summary": "Land at Haneda, settle into Shinjuku.", "meta": "Arrival day", "media_ids": [] },
    { "day_number": 2, "title": "Markets and neighbourhoods", "summary": "Start at the market, then explore nearby streets.", "meta": "Food and culture", "media_ids": [] },
    { "day_number": 3, "title": "Day trip", "summary": "Free day to explore further afield.", "meta": null, "media_ids": [] },
    { "day_number": 4, "title": "Departure", "summary": "Check out and head to the airport.", "meta": null, "media_ids": [] }
  ],
  "flights": [
    {
      "origin_iata": "SYD",
      "destination_iata": "HND",
      "airline": "Qantas",
      "flight_number": "QF1",
      "departure_datetime": "2026-10-01T09:00:00",
      "arrival_datetime": "2026-10-01T18:00:00",
      "cabin_class": "Economy",
      "price_aud": 1200,
      "day_number": 1,
      "sequence_order": 1,
      "notes": "Window seat requested",
      "media_ids": [],
      "source_id": null
    },
    {
      "origin_iata": "HND",
      "destination_iata": "SYD",
      "airline": "Qantas",
      "flight_number": "QF2",
      "departure_datetime": "2026-10-04T20:00:00",
      "arrival_datetime": "2026-10-05T08:00:00",
      "cabin_class": "Economy",
      "price_aud": 1250,
      "day_number": 4,
      "sequence_order": 1,
      "notes": null,
      "media_ids": [],
      "source_id": null
    }
  ],
  "hotels": [
    {
      "hotel_name": "Park Hyatt Tokyo",
      "star_rating": 5,
      "city": "Tokyo",
      "address": "3-7-1-2 Nishi Shinjuku, Tokyo",
      "check_in_day": 1,
      "check_out_day": 4,
      "price_per_night_aud": 500,
      "room_type": "Park Deluxe Room",
      "sequence_order": 1,
      "notes": "High floor requested",
      "media_ids": [],
      "source_id": "catalog-hotel-park-hyatt"
    }
  ],
  "activities": [
    {
      "activity_name": "Market walk",
      "city": "Tokyo",
      "day_number": 2,
      "sequence_order": 1,
      "start_time": "10:30",
      "duration_hours": 1.5,
      "price_aud": 40,
      "category": "Food",
      "address": "Market entrance",
      "description": "Explore the food stalls.",
      "notes": "Meet beside the gate",
      "booking_required": false,
      "media_ids": [],
      "source_id": null
    }
  ]
}
```

Notes on this example: `check_in_day`/`check_out_day` (1 and 4) represent one
hotel stay of 3 nights spanning the whole trip — the FE must send this as a
single `HotelInput`, not one entry per night. The activity omits
`activity_date` in favour of `day_number` (an undated draft placement). The
day-4 return flight and the hotel checkout land on the same `day_number`
without conflicting, because flights/hotels/activities are three independent
collections.

## Example: a partial update (existing collections retained)

For a metadata/day-only edit where the flights and hotels are left alone,
omit those keys entirely — this is the plan's "existing flight and hotel
collections are omitted and therefore retained" case:

```json
{
  "title": "Tokyo food day",
  "description": "A creator-led day exploring local food.",
  "base_price_aud": 450,
  "days": [
    {
      "day_number": 1,
      "title": "Markets and neighbourhoods",
      "summary": "Start at the market, then explore nearby streets.",
      "meta": "Food and culture",
      "media_ids": []
    }
  ],
  "activities": [
    {
      "activity_name": "Market walk",
      "activity_date": "2026-10-01",
      "city": "Tokyo",
      "day_number": 1,
      "sequence_order": 1,
      "start_time": "10:30",
      "duration_hours": 1.5,
      "price_aud": 40,
      "category": "Food",
      "address": "Market entrance",
      "description": "Explore the food stalls.",
      "notes": "Meet beside the gate",
      "booking_required": false,
      "media_ids": [],
      "source_id": null
    }
  ]
}
```

## Frontend work after backend delivery (not part of this backend slice)

Primary files, unchanged by this task:

- [creator-api.ts](../apps/web/lib/creator-api.ts): extend input/detail types
  with the new fields above and add a submit helper.
- [itinerary-builder.ts](../apps/web/lib/itinerary-builder.ts): map persisted
  details to editor days and back without losing time, order, notes, or
  media associations. Deduplicate hotel markers by stay identity — the
  display-only checkout timeline entry cannot reconstruct room/price
  metadata on its own, so the serializer must read it from the original
  stay object, not regenerate it.
- [itinerary-editor.tsx](../apps/web/components/itinerary-editor.tsx): use
  **one serializer** for both Save Draft and Submit for Review so they
  cannot diverge. Implement:

  ```text
  onSubmitForReview:
    prevent duplicate requests and temporarily prevent further edits
    await all pending photo uploads
    payload = serialize current editor domain state
    saved = await PUT /packages/{id} with payload
    replace saved snapshot and IDs with the response
    submitted = await POST /packages/{id}/submit with optional note
    show submitted.status == pending_review and leave edit mode
  ```

  If upload or the PUT fails, preserve local edits and do not call submit.
  If only submit fails, keep the saved draft, display the backend reason,
  and allow retry against the same package ID. Handle `401` (expired
  session), `404` (package unavailable), `409` (no longer editable — status
  changed under it), and `422` explicitly, with actionable messages — branch
  on `error_code`: `VALIDATION_ERROR` (schema), `SAVE_PRECONDITION_FAILED`
  (save business rule), or `SUBMISSION_PRECONDITION_FAILED` (submit
  business rule, with a `details.missing` array). Never show "published" for
  `pending_review`.
- [package-editor-screen.tsx](../apps/web/components/package-editor-screen.tsx):
  consume the complete detail response and respect the returned lifecycle
  status; replace the current local-only `handlePublish`.

On reload, prefer explicit saved placements/times (`day_number`,
`sequence_order`, `start_time`, `check_in_day`/`check_out_day`) before
falling back to the legacy date-based derivation, so a package saved with
relative placement doesn't silently lose it on the next load.

The FE follow-up also needs its own tests (backend completion does not cover
these): a request-order test proving no `submit` call happens after a failed
`save`, and a save/reload test covering ordering, time, hotel deduplication,
and photo associations. Client-side checks and a successful backend save
cannot protect against edits made in a different browser tab; that kind of
version-conflict detection is explicitly out of scope for this slice.

## Acceptance checklist (backend-verifiable portion)

- [x] Create and PUT accept all field-mapping-table fields; creator and
      public detail return them (verified via `apps/api/tests/test_packages.py`
      and `apps/api/tests/test_marketplace_detail.py`).
- [x] Partial saves preserve omitted collections; `[]` clears deliberately;
      `null` on the three restricted collections is rejected with 422
      (verified via `apps/api/tests/test_package_editor_contract.py`).
- [x] Submission reads committed stored components under its own lock,
      counting rows not catalog IDs (verified by code review of
      `submit_package_for_review` — **not executed against a database**).
- [ ] Shared inventory and other users' packages/media cannot be modified —
      verified by code review of the RPCs' ownership checks and grants; **not
      exercised against a real database**.
- [ ] FE save-before-submit sequencing, hotel deduplication, and ordering
      tie-break — not started; tracked as the FE follow-up above.
