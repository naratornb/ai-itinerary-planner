# Co-Pilot Integration and Editor End-Goals Implementation Record

**Goal:** Land the Co-Pilot frontend on a live backend, turn the AI wizard into a real package-creation flow, and close the AI itinerary editor's end-goal gaps — story generation, day persistence, photos, and pricing.

**Branch:** `feat/copilot-integration` (based on `develop`)

**Spec:** `docs/superpowers/specs/2026-09-09-wizard-itinerary-package-mapping.md`

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, FastAPI, Supabase (PostgREST + RLS), Node test runner, pytest

---

## Changes on this branch

### 1. Co-Pilot frontend merge (`chore: merge feat/copilot-frontend`)

**What:** Merged the redesigned itinerary editor, Co-Pilot panel, hotel catalogue, and route map from `feat/copilot-frontend`.

**Why:** The design work and the API work were on separate branches; the editor rewrite is the surface every later change in this list touches.

**Files:** `apps/web/components/itinerary-editor.tsx`, `apps/web/components/copilot/*`, `apps/web/components/hotel-catalog.tsx`, `apps/web/components/route-map.tsx`, `apps/web/app/globals.css`

**Known cost:** the merge dropped the working `generateContent` story call (restored in change 6 below) — a rewrite over a pre-copilot base silently reverted it.

### 2. Co-Pilot wired to the live turns API (`fix: restore the Co-Pilot wiring to the live turns API`)

**What:** Deleted the mock Co-Pilot client and re-pointed the panel and hook at the real `POST /copilot/turns` contract; re-added the versioned request/response types and the Builder-state guards.

**Why:** The merged frontend still spoke to the deterministic mock from the prototype plan, so suggestions were fabricated rather than drawn from real inventory.

**Files:** `apps/web/lib/copilot.ts`, `apps/web/lib/copilot-client.ts`, `apps/web/components/copilot/*`, `apps/web/lib/itinerary-builder.ts`

### 3. Real package creation from the wizard (`feat: create a real AI-generated package from the wizard`)

**What:** The AI wizard now renders its selections into an engine query, calls `/api/ai/recommend`, maps the response onto a `POST /packages` body, and opens the editor on the persisted package.

**Why:** The wizard previously ended on a mock preview; nothing it produced ever became a package a creator could edit or publish.

**Files:** `apps/web/lib/ai/itinerary.ts`, `apps/web/lib/creator-api.ts`, `apps/web/components/ai-wizard-screen.tsx`, `apps/web/app/api/ai/recommend/route.ts`

### 4. AI itinerary persistence and the mapping spec

**What:** Documented and implemented the wizard → engine → package field mapping, including the skip rules that drop an invalid component instead of failing the whole create.

**Why:** The mapping has enough engine quirks (single-theme detection, undated days, IATA extraction) that it needed a written source of truth rather than living only in code comments.

**Files:** `docs/superpowers/specs/2026-09-09-wizard-itinerary-package-mapping.md`, `apps/web/lib/ai/itinerary.ts`

### 5. Co-Pilot timeout relaxation (`fix: relax copilot timeouts for cold serverless starts`)

**What:** Raised the Co-Pilot router/service upstream timeouts.

**Why:** A cold serverless start regularly exceeded the previous budget, so the first turn of a session failed for reasons unrelated to the request.

**Files:** `apps/api/app/copilot/router.py`, `apps/api/app/copilot/service.py`

### 6. Editor end-goals — story, day persistence, photos, pricing (this round)

**a. `days` write path (backend).** New `PackageDayInput`; `TravelPackageCreate.days` inserts `package_days` rows with the caller's JWT (RLS grants the owner ALL — no admin headers), `TravelPackageUpdate.days` replaces the set by delete-then-insert. Files: `apps/api/app/packages/schemas.py`, `service.py`.

**b. Wizard maps day titles.** `itineraryToPackageInput` now collects `{ day_number, title, summary }` from `EngineDay`, with `day_number` falling back to the index + 1 and days carrying neither a title nor a description skipped. Files: `apps/web/lib/ai/itinerary.ts`, `apps/web/lib/creator-api.ts`, plus the spec's mapping table.

**c. Story generation restored.** `generateContent` calls `POST /api/ai/generate-content` (Gemini, returns `{listing}`) with the active day's non-flight/hotel stops, the selected hotel, and the package's destination. The route handler was never broken — only the component wiring was lost in the merge. File: `apps/web/components/itinerary-editor.tsx`.

**d. Day title/summary editing.** Inline edit on the active day's heading, mirroring the existing package-title pattern.

**e. Real Save Draft.** New `updatePackage` in `creator-api.ts`; the button PUTs `{ title, base_price_aud, days }` with the Supabase session token and surfaces failures as a notice.

**f. Photos wired to the media API.** `uploadPackageMedia` / `deletePackageMedia` / `listPackageMedia` in `creator-api.ts`; the day photo grid uploads with an optimistic blob preview, swaps in the returned URL, supports removal, and loads existing media on mount.

**g. Pricing fixes.** `computePackagePrice` (in `itinerary-builder.ts`) skips `stayMarker === "check-out"` rows so a two-night stay no longer bills as three; `createHotel` gives the rounding remainder to the first night so the nightly rows sum to the room total exactly; the inverted `stayGroupId` branch is fixed so the rich hotel detail panel resolves for real packages (now by stay-group key rather than by counting rows within a single day).

---

## Deliberate simplifications

- The editor syncs back only the package title, price, and day titles/summaries. Timeline items, hotels, and flights stay local — the API replaces those by delete/re-add, which is a separate feature.
- Media rows carry no day association server-side, so existing photos all load onto day 1.
- Per-activity photos remain local blob URLs; the media API attaches files to a package, not to a timeline item.
- The 20% commission stays a frontend constant. There is no backend commission concept to read from.

---

## Pending

### Visibility / feasibility score before publish

**Decision:** wait. Do not merge or stub the feature here.

The editor's "Package quality" score and the feasibility panel are still hardcoded. The real calculation belongs to the feasibility-check work in **PR #66 (`feat/feasibility-checks`)**; the editor should compute a visibility score from those checks before allowing publish. Integrate after that PR merges.

**Known integration hazards:**

- `apps/web/components/itinerary-editor.tsx` will conflict heavily. PR #66 branches from a pre-copilot base, so its editor file predates the Co-Pilot rewrite — expect a manual reconciliation rather than a mechanical merge, and re-verify the story, photo, and pricing wiring above afterwards.
- Migration numbering collides: PR #66 adds a `0012_*` migration, and this branch already has `0012_package_copilot.sql`. One of them has to be renumbered before both land.


---

## Review-fix round (same day)

A senior-review pass over the editor end-goals diff produced these applied fixes:

- **Wizard day rows now use position, not the engine's `day_number`** (`apps/web/lib/ai/itinerary.ts`). A zero/negative value 422s against `Field(ge=1)`, and a duplicate violates `UNIQUE(package_id, day_number)` — either would abort the whole package create.
- **Stay-head row detection un-inverted** (`apps/web/components/itinerary-editor.tsx`): the aggregate hotel title and stay total now render on the check-in row, matching how `buildDaysFromPackage` marks rows.
- **`update_package` days replacement is upsert-then-trim** (`apps/api/app/packages/service.py`): upsert with `Prefer: resolution=merge-duplicates` on `(package_id, day_number)` and delete only `day_number > len(days)` — deleting first risked losing every title/summary if the insert then failed (no transaction across PostgREST calls).
- **Save Draft** rounds `base_price_aud` (backend requires an int) and sends `null` instead of the generated "Day N" placeholder title. `updatePackage` now surfaces the backend's error message (e.g. `PACKAGE_NOT_EDITABLE`) instead of a generic retry line.
- **Day-photo remove button styled** (`apps/web/app/globals.css`): the `.remove-photo-btn` rules were scoped to `.edit-photo figure` only; they now apply in the day grid too, with `position: relative` on grid figures.
- Tests updated/added for the upsert-then-trim call shape and the position-wins day numbering.

---

## Day description moved into "Your story" (user-requested rework)

The day-summary edit control was removed from the day heading (the heading shows only "Day N" + the editable title, as on develop). The AI-generated day description now loads into the per-day "Your story" textarea (`buildDaysFromPackage` maps `package_days.summary` → `BuilderDay.story`), and Save Draft persists the textarea back to `package_days.summary`. The day tab's subtitle mirrors the story via `daySubtitle()` (`apps/web/lib/itinerary-builder.ts`), clipped to 48 characters with a trailing ellipsis. Files: `itinerary-editor.tsx`, `itinerary-builder.ts`, tests.
