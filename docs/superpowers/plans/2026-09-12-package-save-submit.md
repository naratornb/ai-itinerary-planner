# Complete Package Save and Review Submission Execution Plan

> **For agentic workers:** Use `superpowers:executing-plans` to execute this plan sequentially after approval. Check off steps only after their verification passes.

**Status:** Plan only. No backend or frontend implementation changes are authorized by this document alone.

**Goal:** Save the editable itinerary through the existing package API, return all persisted travel details on reload, and submit the saved package through the separate review endpoint.

**Architecture:** Extend `POST /packages`, `PUT /packages/{package_id}`, and their detail responses. Reuse existing package/component tables, add typed package-specific component data without modifying shared inventory, and perform each save in one PostgreSQL transaction. Keep `POST /packages/{package_id}/submit` separate, but move its checks and status transition into one transaction too.

**Tech stack:** Existing FastAPI, Pydantic v2, requests/PostgREST, PostgreSQL/Supabase, pytest. No new application dependency.

**Spec:** [Frontend save/submit handover](../../frontend-package-save-submit-handover.md). This plan resolves that document's proposed persistence choices and undated-draft behavior.

## Scope and constraints

- Backend implementation and FE handover only. Do not edit `apps/web` in this execution. The FE work below is an explicit follow-up for its developer.
- Preserve the existing paths. PUT saves content; `/submit` changes status. Neither PUT nor submission makes a package publicly live.
- Preserve metadata-only clients, existing AI wizard creation payloads, legacy package reads, and the approval/publication workflow.
- Test-first for the data-loss regression. No dependency additions, generic repository layer, new component CRUD endpoints, or arbitrary whole-editor JSON blob.
- Migrations are append-only. Do not run `supabase db push`, apply SQL to a remote database, or create a local Supabase stack. Deployment is handled separately through the repository's migration workflow.
- Do not commit directly to `main` or `develop`, push automatically, or commit unrelated working-tree changes.
- Before implementation, get the plan confirmed and record it in a GitHub issue/PR as required by `AGENTS.md`. Ask the owner whether to keep the current documentation changes with this feature or use a separate branch. Do not silently move, commit, or discard them.

## 1. Contract decisions

### Operation behavior

| Operation | Behavior after this change |
| --- | --- |
| `POST /packages` | Create a draft and its supplied days/components atomically; accept the same detailed component fields as PUT |
| `PUT /packages/{package_id}` | Partially update metadata and replace only supplied collections; return complete persisted detail |
| `GET /packages/{package_id}` | Return saved content, including day placement, ordering, notes and media IDs |
| `GET /marketplace/packages/{package_id}` | Return the same travel-content fields for a live package using the existing shared detail conversion |
| `POST /packages/{package_id}/submit` | Validate stored content and change draft/rejected to pending_review atomically; do not accept editor content |

For `flights`, `hotels`, and `activities`: omission means unchanged; an array replaces the collection; `[]` deliberately clears it; explicit `null` returns 422. Preserve existing `days: null` behavior as no change for compatibility; document that clients should omit unchanged days. Supplied `days: []` clears day narratives. Collection replacement is scoped to this package only.

Metadata fields retain current partial-update behavior. Do not add lifecycle fields to the update input. Keep existing handling of unrelated unknown fields for compatibility; explicitly test that all fields documented below are accepted and returned rather than silently dropped.

### Detailed field mapping

Retain all current component fields. Add the following to both input and detail output models, with defaults allowing old payloads and legacy records:

| Object | Additional fields / behavior |
| --- | --- |
| Day | `meta: string \| null`, `media_ids: UUID[]`; retain `day_number`, `title`, `summary` |
| Flight | `day_number: integer \| null`, `sequence_order: integer \| null`, `notes: string \| null`, `media_ids: UUID[]`, `source_id: string \| null` |
| Hotel stay | `check_in_day: integer \| null`, `check_out_day: integer \| null`, `sequence_order: integer \| null`, `notes: string \| null`, `media_ids: UUID[]`, `source_id: string \| null` |
| Activity / creator pick | `day_number: integer \| null`, `sequence_order: integer \| null`, `start_time: string \| null` in `HH:MM`, `category: string \| null`, `address: string \| null`, `notes: string \| null`, `media_ids: UUID[]`, `source_id: string \| null` |
| Component output | `package_component_id: UUID \| null` identifying its package link; existing catalog IDs remain nullable and are not required for custom items |

`source_id` records provenance only. It is not permission to read or modify inventory. A full replacement may assign new package-component IDs; clients consume the response rather than treating local timeline IDs as database IDs.

One hotel stay represents its full interval. Repeated nightly rows and the check-out marker in the editor are renderings of that stay, not extra hotel bookings. Persist dates or relative day bounds, room type, star rating, nightly price, address, notes, and media once per stay. Keep real flight departure/arrival datetimes; do not replace them with the editor's formatted arrival label.

UI icons, validation highlights, formatted currency, modal state, and generated hotel marker labels are derived and not persisted. Preserve actual user-authored content. `days[].summary` stores the day story; component `notes` stores notes independently from an activity's description.

### Undated drafts and validation

- Activities may omit `activity_date` when `day_number` is supplied. Hotels may omit both concrete dates when valid `check_in_day` and `check_out_day` are supplied. Existing date-based inputs continue to work. Do not invent dates from the current clock.
- Flights still require real departure/arrival datetimes in the existing input format; this change does not introduce undated flight placeholders.
- For relative placements, enforce `1 <= day_number <= effective duration_days`. Hotel check-out must follow check-in and may be `duration_days + 1` to represent the departure boundary. Validate the final merged package, including unchanged components when duration shrinks.
- Require positive integer sequence positions when provided. Use supplied positions for cross-type day order; ties use component type then package-component ID as a deterministic fallback. Legacy items without positions keep existing fallback behavior.
- Reject duplicate day numbers and media IDs within one association. Days need not be contiguous: replace/prune by exact supplied day numbers, fixing the current trim-by-array-length behavior.
- Validate `HH:MM` time, finite non-negative prices/durations, hotel date/day intervals, and flight timestamp ordering. Monetary API values remain whole AUD integers. Do not tighten the lenient legacy output models.
- Every media ID must exist and belong to the same package; reject foreign or missing references with 422. Blob/object URLs and arbitrary image URLs are not accepted as stored photo associations.

## 2. Persistence design

Reuse `package_flights`, `package_hotels`, `package_activities`, and `package_days` rather than adding a second itinerary model.

Add a nullable, object-constrained `details JSONB` column to each component junction table and allow its existing catalog foreign key to be null for custom package components. `details` is a serialized, validated component input, not unchecked editor state. Existing foreign keys and legacy rows remain intact. For a newly saved component, `details` is its complete authoritative travel-content snapshot; native day/date/order/notes columns are synchronized projections used by existing readers and ordering. For a legacy component with `details IS NULL`, retain the current catalog-plus-junction read path.

This avoids altering shared catalog prices/names or inserting duplicate inventory rows on every save. New custom components have nullable catalog IDs, as already permitted by detail outputs. `package_component_id` identifies the real package record. Submission must count package component rows, not non-null catalog IDs. Compute pricing from effective saved details, including relative hotel nights when concrete dates are absent.

Add day `meta` and ordered `media_ids` columns. Component media IDs live in typed `details`. Add a media-delete trigger that locks the parent package, enforces editable status, and removes the deleted ID from day/component associations within the same transaction. This prevents dangling references and orders media deletion against saves and submission. Keep the existing storage-object cleanup behavior; do not build a storage transaction framework.

Create migration-defined RPC functions:

```text
save_package_details(p_actor_id uuid, p_package_id uuid, p_payload jsonb) -> jsonb
submit_package_for_review(p_actor_id uuid, p_package_id uuid, p_note text) -> jsonb
```

For create, `p_package_id` is null. The API derives `p_actor_id` from the validated bearer token, never request JSON. Call these functions with server-only service-role headers. Revoke execution from PUBLIC, anon, and authenticated; grant only service_role, set an explicit search_path, qualify table names, and check creator ownership inside both functions. Keep existing table RLS enabled. Do not expose a general SQL executor or client-supplied actor ID.

Return a small outcome envelope, matching existing service conventions:

```json
{ "outcome": "ok", "package_id": "<uuid>" }
```

Other outcomes: `not_found`, `not_editable`, or `precondition_failed` with failure details. Treat ownership mismatch as not found. Expected failures must occur before writes; unexpected database exceptions roll the whole transaction back and use the existing sanitized upstream-error response.

Save locks the owned package row before checking status or writing any metadata/collection. Submit acquires that same lock **before reading components**, checks stored status, component presence and positive price, then sets status/submission note/timestamps. Checking components first and locking only for the status update leaves the existing race unfixed.

Transaction rollback applies to database mutation failures. A network timeout or a failed detail read after commit can leave the save outcome uncertain; document that the client should reload/reconcile before retrying or submitting, rather than assuming a failed HTTP response proves rollback.

Save remains last-writer-wins across separate editor sessions. Do not add versioning, ETags or a collaboration protocol in this slice. The FE must await its successful save and prevent further local edits while its submit sequence is in flight; backend transactions cannot detect content that was never sent.

## 3. File map

| File | Work |
| --- | --- |
| `apps/api/app/packages/schemas.py` | Extend typed create/update/detail/day models and cross-field validation |
| `apps/api/app/packages/service.py` | Replace multi-call mutation paths with save/submit RPCs; flatten snapshots or legacy embeds; calculate effective pricing |
| `apps/api/app/packages/router.py` | Pass authenticated actor to submit; map validation/outcome errors without changing endpoint roles |
| `supabase/migrations/0013_package_editor_persistence.sql` | Columns, nullability, constrained RPCs, media reference cleanup; choose next free version again at execution time |
| `apps/api/tests/test_packages.py` | Extend existing test harness with detailed save/read and submit regressions |
| `apps/api/tests/test_package_editor_contract.py` | Focused schema/OpenAPI agreement and payload round-trip checks |
| `apps/api/tests/package_editor_persistence.sql` | Runnable transaction, rollback, ownership, media and legacy SQL checks |
| `apps/api/tests/test_marketplace_detail.py` | Prove public detail retains saved fields and effective prices |
| `apps/api/app/media/service.py` | Map the media trigger's non-editable race outcome to the existing 409 contract |
| `apps/api/tests/test_media.py` | Verify deletion error mapping remains compatible with the new trigger |
| `apps/api/openapi.yaml` | Exact request/response fields, replacement semantics, undated drafts, error examples, minor version bump |
| `docs/fc_db_diagrams.excalidraw` | Update changed tables and schema-version label, per database guidance |
| `docs/frontend-package-save-submit-handover.md` | Replace proposed mapping with verified payload, FE sequence, errors, deployment prerequisite |
| `docs/frontend-api-usage.md` | Note that backend support changed while FE call sites remain unchanged |

The marketplace detail route already uses `TravelPackageDetail` and the shared conversion, so no separate marketplace schema redesign is needed. Read Co-Pilot's junction-table context before changing projections; run its existing tests to preserve compatibility.

## 4. Execution tasks

### Task A — Reproduce loss and implement the typed payload

**Interfaces:** Existing `TravelPackageCreate`, `TravelPackageUpdate`, and `TravelPackageDetail` remain their public model names; their component fields follow section 1.

- [ ] Add a regression that fails today because PUT discards `activities`:

```python
from app.packages.schemas import TravelPackageUpdate


def test_update_retains_activity_editor_fields():
    activity = {
        "activity_name": "Market walk",
        "activity_date": "2026-10-01",
        "city": "Tokyo",
        "day_number": 1,
        "sequence_order": 2,
        "start_time": "10:30",
        "duration_hours": 1.5,
        "price_aud": 40,
        "category": "Food",
        "address": "Market entrance",
        "notes": "Meet beside the gate",
        "media_ids": [],
    }
    saved = TravelPackageUpdate.model_validate({"activities": [activity]})
    body = saved.model_dump(mode="json", exclude_unset=True)
    assert body["activities"][0] == activity
```

- [ ] Run `.venv/bin/python -m pytest -q tests/test_package_editor_contract.py` from `apps/api`; record the expected missing-field failure before editing models.
- [ ] Add schema cases for omission/empty/null, full flights/hotels/days, relative-only drafts, invalid time/date intervals, non-finite numbers, and duplicate day/media IDs. Assert precise accepted/rejected behavior from section 1.
- [ ] Implement fields in the existing models. Serialize in JSON mode before RPC calls; retain `exclude_unset=True` so omission is distinguishable from clearing.
- [ ] Run the focused schema checks. Keep output fields nullable/defaulted so old records still serialize.

### Task B — Persist complete saves atomically

**Interfaces:** `service.create_package(uid, headers, payload)` and `service.update_package(package_id, headers, uid, payload)` retain their current signatures and response conventions; both call `save_package_details`.

- [ ] Extend `test_packages.py` using its existing `FakeRequests` harness. Assert one mutation RPC receives all supplied component/day fields and the token-derived actor. Stub the post-save detail GET separately.
- [ ] Assert metadata-only payloads omit collection keys, `[]` reaches the RPC unchanged, unauthorized/locked packages map to the established 404/409 responses, and database failures never report success.
- [ ] Write SQL checks that seed two creators, two packages sharing catalog inventory, one package-owned photo, and one foreign photo inside a rollback-only test transaction. Assert replace/clear/omit behavior, preservation of the second package and catalog rows, rejection of foreign media, and rollback after an intentionally failing late write.
- [ ] Add the migration described in section 2. Validate final-state bounds before mutations and use exact day-number replacement rather than length-based trimming. Keep all save writes within the function call transaction.
- [ ] Replace the existing sequential create/update write paths with the RPC adapter. Do not retain two competing component-save implementations. Continue using the existing `_call` error sanitization and final detail read.
- [ ] Run focused package tests. Mock success alone is not evidence that the SQL transaction works; retain the SQL checks as an explicit deployment verification requirement.

### Task C — Read back saved content through every detail path

**Interfaces:** `_to_detail(row)` retains its signature; it prefers typed snapshot data when present and falls back to legacy catalog embeds when absent.

- [ ] Add a fixture containing both a legacy linked component and a new custom component with a null catalog ID. Assert IDs, day/order, start time, category, address, notes, source and media IDs survive conversion and response serialization.
- [ ] Assert prices use edited component data; hotel totals use actual stay nights and do not charge a second stay for check-out rendering.
- [ ] Implement the conversion and synchronized junction projections. Include `package_component_id`; preserve existing response keys. Ensure stored day meta and photo IDs are returned.
- [ ] Run package, public-detail, and Co-Pilot regressions. A public detail test must use `GET /marketplace/packages/{id}` so the FastAPI response model cannot silently strip fields.
- [ ] Add SQL media-deletion checks proving all associated references are removed and cross-package references cannot be saved. If a concurrent submit makes the deletion trigger reject a delete after the service precheck, translate that known database outcome to `409 PACKAGE_NOT_EDITABLE` in `apps/api/app/media/service.py`; keep other upstream failures sanitized. Test this mapping in `test_media.py`.

### Task D — Submit the persisted package under the same lock

**Interfaces:** Extend `service.submit_package(package_id, headers, note)` to receive authenticated `uid`; update its router caller and tests together. The HTTP path and optional `submission_note` request remain unchanged.

- [ ] Add regressions for: saved valid content submits; a saved empty required collection causes 422; a pending-review package rejects later saves; custom components count even with null catalog IDs; ownership mismatch returns 404.
- [ ] Implement the separate `submit_package_for_review` RPC. Check ownership, lock, status, all three component-row counts and positive price before changing status.
- [ ] Preserve `422 SUBMISSION_PRECONDITION_FAILED`, optional note length 500, and HTTP 200 summary on success. Submission must not call approve/publish or accept component arrays.
- [ ] Supply a two-connection database check: hold the package lock during a save that clears activities, start submit, commit save, then assert submit rechecks and returns the missing-activity failure. Reverse the order and assert the later save rejects pending-review status. Run only against an approved disposable test database with migrations already deployed through the permitted workflow.
- [ ] Run package and approval tests. Do not claim concurrency verification from mocked requests; report database execution status separately.

### Task E — Contract, FE handover and release checks

- [ ] Update OpenAPI with the exact models from Task A, nullable custom catalog IDs, full save semantics, date-relative alternatives, new response fields and examples. Remove the unsupported “delete and re-add components” instruction. Bump the current minor version (`2.2.0` becomes `2.3.0` if unchanged at execution).
- [ ] Add a contract check that validates the handover payload against Pydantic and compares documented component/day properties and required fields with the runtime models. Parse YAML, resolve local references and check operation-ID uniqueness.
- [ ] Finalize the handover with the payload and FE algorithm below. Label backend code readiness separately from migration deployment. Update the audit without counting planned FE integrations as already used.
- [ ] Update the schema diagram and check its version matches the new migration.
- [ ] Run from `apps/api`: `.venv/bin/python -m pytest -q`, `.venv/bin/ruff check .`, and `.venv/bin/python -c "from app.main import app"`.
- [ ] Before any requested commit, also run the repository-required `npm run lint` and `npm run build` from `apps/web`. No frontend implementation edits are needed to perform those checks.
- [ ] Run `git diff --check`, inspect the full diff, check forbidden terminology and documentation links, and record which database checks actually ran. Do not add an environment-dependent skipped test or weaken a gate.
- [ ] Present the verified backend diff and handover for review. Commit only if requested; any push requires approval for that specific push.

## 5. FE integration contract — handover, not work in this backend slice

After backend deployment, the FE developer updates `creator-api.ts`, `itinerary-builder.ts`, and `itinerary-editor.tsx` to build the structured payload. Use one serializer for Save Draft and Submit for Review so they cannot diverge.

Example PUT for an existing one-day package (existing flight and hotel collections are omitted and therefore retained):

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

The final handover must also include a full example containing flights and one multi-night hotel stay, verified against the implemented models. The example above is deliberately a partial update, not an empty collection replacement for those types.

Map `BuilderDay.story` to `summary`, `meta` directly, activity time to `start_time`, activity duration minutes to numeric hours, and formatted money to integer AUD. Map photos to uploaded media IDs, not preview URLs. Keep flight fields from the original detail object and deduplicate hotel markers by stay identity; the display-only timeline title cannot reconstruct flight/room metadata. On reload, use explicit saved placements/times before falling back to the old date-based derivation.

Implement this sequence in the follow-up FE change:

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

If upload or PUT fails, preserve local edits and do not call submit. If only submit fails, keep the saved draft, display the backend reason, and retry against the same package ID. Handle 401, 404, 409, and 422 explicitly. Never show “published” for pending_review. Client checks and a successful backend save cannot protect unsent edits from a different browser tab; version conflict detection is outside this slice.

The FE follow-up needs a request-order check proving no submit occurs after a failed save, plus a save/reload check for ordering, time, hotel deduplication and photo associations. These are not backend-completion claims.

## Done criteria

- [ ] Create and PUT accept all agreed travel-domain fields; creator and public detail return them intact.
- [ ] Partial saves preserve omitted collections; deliberate clears work; failures roll back the full save.
- [ ] Shared inventory and other users' packages/media cannot be modified through the new save path.
- [ ] Submission reads committed stored components under its lock and remains a separate status transition.
- [ ] Existing metadata-only callers, AI creation, Co-Pilot, approvals and legacy detail responses pass regression checks.
- [ ] Swagger and the FE handover match the actual implementation, and deployment/test limitations are stated accurately.
- [ ] No frontend behavior is claimed fixed until its separate mapping and save-before-submit integration lands.
