# Local travel packages implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Native execution is recommended for this single task.

**Goal:** Allow flightless local packages through submission, approval, and publication.

**Architecture:** The atomic `submit_package_for_review` database function owns component requirements. Remove its mandatory flight check through migration 0020 and derive local classification from an empty flight list. Reuse existing creation, approval, publication, and detail paths.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, requests/PostgREST, pytest, PyYAML, Ruff. Existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-08-local-travel-packages-design.md`

## Execution adjustment

Fetching latest `develop` exposed changes since the original investigation: validation moved from Python to an atomic RPC, and the API version is now `2.6.0`. The steps below target that implementation while preserving the approved package rules.

## Global constraints

- Submission requires `draft` or `rejected`, at least one hotel, at least one activity, and `base_price_aud > 0`.
- A package with zero flight components is local and returns `flights: []` in detail responses.
- Lifecycle is `draft → pending_review → approved → live`; preserve ownership and admin review checks.
- Contract version becomes `2.7.0`; response shapes stay compatible.
- Apply Ponytail full mode and repo/API AGENTS.md instructions; mock external services in tests.
- Execute on a branch off current `origin/develop`, suggested `fix/local-travel-packages`. Use the worktree skill at execution time to inspect the existing workspace before creating isolation.
- Commit only after required gates pass. Push requires specific human approval.

## Review focus

- Flightless rejected packages must resubmit as successfully as drafts.
- Flightless packages missing a hotel or activity must still return 422 with accurate missing-component details.
- Flightless packages priced at zero must return 422 without a status write.
- Flightless packages in another lifecycle status must reject submission without a status write.
- Empty flight lists must survive creator detail and public detail serialization after publication.

## File map

- Create `supabase/migrations/0020_local_travel_packages.sql`: replace the submission function with flights optional.
- Create `apps/api/tests/local_travel_packages.sql`: assert actual database validation behavior in disposable local PostgreSQL.
- Modify `apps/api/tests/test_packages.py`: submission regression cases, creator detail, and a mocked local-package lifecycle check.
- Modify `apps/api/tests/test_marketplace_detail.py`: strengthen existing empty-flight detail coverage using a realistic local package.
- Modify `apps/api/openapi.yaml`: optional-flight semantics, local definition, and version.
- Modify `apps/api/tests/test_package_editor_contract.py`: update the exact current version assertion to `2.7.0`.
- Existing approval services and tests remain the reference for state transitions.

---

### Task 1: Allow local packages through the existing lifecycle

**Interfaces:**
- Consumes `TravelPackageCreate.flights`, default `[]`, and PostgREST `package_flights`, `package_hotels`, and `package_activities` embeds.
- Preserves `submit_package(package_id, headers, uid, note)`, returning `("ok", summary)` or the existing failure outcome and details.
- Preserves `POST /packages/{package_id}/submit`, `POST /approvals/{package_id}/approve`, `POST /approvals/{package_id}/publish`, and both detail routes.
- Success returns HTTP 200 with existing summary fields; failed submission returns HTTP 422 with `SUBMISSION_PRECONDITION_FAILED`.

- [x] **Step 1: Add the failing SQL regression.**

Create `apps/api/tests/local_travel_packages.sql` using a rollback transaction, one creator-owned package, custom hotel/activity rows with null catalog IDs, zero flights, and price 500. Assert draft and rejected submission succeeds, state becomes `pending_review`, and timestamps/note persist. Also assert missing hotel/activity, zero price, invalid statuses, ownership mismatch, and execution privileges retain their existing behavior. A package containing a flight must still succeed.

- [x] **Step 2: Run the reproduction against the actual function.**

Replay `apps/api/tests/local_verify/00_supabase_shim.sql` and all migrations into disposable local PostgreSQL. Run `psql -v ON_ERROR_STOP=1 -f apps/api/tests/local_travel_packages.sql` against that database. Expected before implementation: the flightless draft fails. Execution reproduced an earlier error while appending the required-flight failure, `malformed array literal: "flight"`. Keep verification local; never apply migrations to the remote database.

- [x] **Step 3: Add focused HTTP coverage using existing fakes.**

Add `test_get_local_package_detail` by copying `DETAIL_ROW` and setting `package_flights=[]`. Assert HTTP 200, `flights == []`, zero `pricing.flights_total`, and retained hotels/activities on the creator GET route.

Add `test_local_package_lifecycle` in `test_packages.py`, reusing `FakeRequests`, `FakeResp`, and `_summary_row`. Point `app.approvals.service.requests` at the same fake namespace and override `core.require_admin_ctx` for approval. Queue successful submission RPC, pending-review summary fetch, approval fetch/audit insert/PATCH, and publication fetch/PATCH. Call submit, approve, and publish in order. Assert HTTP 200 for each, submission `status == "pending_review"`, approval `package.status == "approved"`, publication `status == "live"`, and populated `published_at`. Finally fetch creator/public detail with empty flight arrays. These HTTP checks cover integration and serialization; the SQL check proves component validation.

Add a public local-detail test using a fresh deep copy of `FIXTURE`, retaining hotels/activities and setting `package_flights=[]`. Assert empty flights, retained components, and pricing totals excluding flights. Preserve existing flight-containing detail tests.

- [x] **Step 4: Apply the minimal database change.**

Create migration 0020 by copying `submit_package_for_review` from migration 0013. Remove the flight counter declaration, count query, and mandatory-flight failure. Use `array_append` for the hotel/activity missing-component entries and price failure to fix the malformed-array errors exposed by the real SQL regression. Preserve signature, ownership, row locking, hotel/activity counts, price/status validation, timestamps, error structure, and privileges. Include the existing REVOKE/GRANT and schema reload. Leave historical migrations and the Python RPC adapter intact.

- [x] **Step 5: Update the canonical contract.**

Set `info.version` to `"2.7.0"`. Replace the mandatory-flight precondition with a statement that flights are optional and zero flights define a local travel package. Document omitted/empty flights in creation and `flights: []` in package detail. Keep the hotel, activity, price, role, and status rules explicit.

- [x] **Step 6: Verify the affected feature and contract.**

Run from `apps/api`: `python -m pytest tests/test_packages.py tests/test_approvals.py tests/test_marketplace_detail.py -v`.
Rerun the SQL regression after replaying migration 0020. Expected: SQL assertions pass, along with all affected HTTP tests, including local submissions and existing publication status/race checks. Existing `test_openapi_yaml_served_and_valid` checks that the contract is served and parseable. Inspect the parsed contract for version `2.7.0` and the new submission semantics.

- [x] **Step 7: Run required gates and self-review.**

From `apps/api`, run `python -m ruff check .`, `python -m pytest`, and `python -c "from app.main import app"`. From `apps/web`, run `npm run lint` and `npm run build`. All must pass before committing. Review `git diff --check` and the actual diff against the spec, including the repo's terminology rules. If a gate fails, resolve the cause within scope or report the blocker without weakening the gate.

- [x] **Step 8: Commit the verified slice.**

Stage only the migration, focused tests, contract, and these design/plan documents. Commit as `fix: allow local travel packages without flights`. The PR targets `develop` and describes the submission blocker, derived local classification, exact verification commands/results, and the retained hotel/activity requirement. Request specific push approval before publishing the branch.

## Verification record

- Baseline API suite: 192 passed.
- SQL RED: flightless submission failed in migration 0013 with a malformed flight-error array. Removing only the flight requirement exposed the same bug in the zero-price guard.
- SQL GREEN: migration 0020 and `local_travel_packages.sql` passed on disposable PostgreSQL 17 after replaying migrations 0001–0019; tested flightless draft/rejected submission, required components, price/status/ownership guards, service-only execution, and a flight-containing package.
- Focused API/contract tests: 113 passed. Full API suite: 195 passed, with one existing Starlette deprecation warning.
- `python -m ruff check .`, API import smoke check, `npm run lint`, and `npm run build` passed. Web lint reported 27 existing warnings; build reported the existing workspace-lockfile warning.
- Parsed OpenAPI verifies version `2.7.0`, optional flights, and retained hotel/activity requirements.
- No migration was applied to a remote database. The git deployment pipeline must apply migration 0020 after merge before the new behavior is available remotely.

- Before push, rebased onto updated `develop` at `88fcdfd`, which already used API `2.6.0`; the final contract is `2.7.0`. Reverification passed 197 API tests, Ruff, import smoke check, web lint with 28 existing warnings, and production build.
