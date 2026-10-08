# Admin Review Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a frontend-only `/admin` dashboard that shows the real pending-review queue, its total and oldest waiting submission, and routes each package toward a separate review page.

**Architecture:** A typed API client owns the existing approvals and users calls, a pure model module owns formatting and fallbacks, and one client component coordinates session, access, pagination, sorting, and optional creator enrichment. A thin App Router page renders the feature; a pure exported view keeps the important UI states testable without a browser DOM.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase browser auth, native fetch, node:test, React server rendering for view tests, existing CSS/tokens, anydesign.

**Spec:** `docs/superpowers/specs/2026-10-07-admin-review-dashboard-design.md`

## Global Constraints

- Frontend only: do not modify `apps/api/`, `apps/api/openapi.yaml`, Supabase migrations, or RLS policies.
- Use only the existing `GET /approvals`, `GET /users`, and Supabase session contracts.
- Use `GET /approvals` as the authorization gate; call `GET /users` only after it succeeds.
- Show no invented approved, rejected, historical, or demo data.
- Keep approve and reject actions out of the dashboard.
- Add no dependency; reuse repository code, platform APIs, and installed packages.
- Implement against committed `apps/web/design/design.md` and `apps/web/design/design-tokens.json` decisions.
- TypeScript only; no `any`, `@ts-ignore`, skipped tests, or weakened lint/type gates.
- Generate the review path through `adminApprovalRoute(packageId)`, never inline in JSX.
- The reserved review-detail route is the next frontend slice; this branch is not integration-ready until that route exists or the action is unavailable in the reviewed build.

## Review Focus

- **No session:** redirect to `/login` before any admin API call; Task 4 tests the controller dependency path.
- **Authenticated non-admin:** render the explicit access-required state on approval-list 403; Task 4 tests the state mapping and Task 3 tests its markup.
- **User enrichment failure:** keep every approval visible with deterministic creator-ID fallbacks; Tasks 2–4 test the non-blocking path.
- **Missing or invalid `submitted_at`:** show `Not available` and never emit `NaN` or crash; Task 3 tests the formatter and view.
- **Late response after sort/page change:** do not let stale data replace the current request; Task 4 uses an active-request sequence guard and tests its reducer/helper.

---

## File Structure

- Modify `apps/web/design/design.md` — document the supplied dashboard reference as an admin-workspace extension of the existing system.
- Modify `apps/web/design/design-tokens.json` — add only admin component dimensions not already represented by shared tokens.
- Create `apps/web/lib/admin-api.ts` — typed existing-endpoint client and error classification.
- Create `apps/web/lib/admin-api.test.ts` — request, response, and failure tests.
- Create `apps/web/lib/admin-review.ts` — pure formatting, creator fallback, range, and request-state helpers.
- Create `apps/web/lib/admin-review.test.ts` — deterministic model tests.
- Modify `apps/web/lib/routes.ts` — add `adminApprovalRoute(packageId)`.
- Modify `apps/web/lib/routes.test.ts` — pin encoding and route shape.
- Create `apps/web/components/admin/admin-review-dashboard.tsx` — controller plus exported pure view.
- Create `apps/web/components/admin/admin-review-dashboard.test.ts` — view-state and content tests.
- Create `apps/web/app/admin/page.tsx` — thin route.
- Modify `apps/web/app/globals.css` — token-grounded admin layout, table, card, focus, and responsive styles.

### Task 1: Translate the Wireframe Into the Existing Design System

**Files:**
- Modify: `apps/web/design/design.md`
- Modify: `apps/web/design/design-tokens.json`

**Interfaces:**
- Consumes: the supplied admin wireframe and the existing design frontmatter/tokens.
- Produces: documented `admin-review-summary` and `admin-review-queue` components plus DTCG component tokens used by Task 4 CSS.

- [ ] **Step 1: Read the anydesign analysis references before editing**

Read `.claude/skills/anydesign/references/analysis-framework.md`, `token-extraction.md`, and `output-template.md` completely. Treat the wireframe as reconstruction + design-system input, with the existing product tokens taking precedence over the wireframe palette.

- [ ] **Step 2: Update the design analysis**

Add the admin approval workspace to the source, component inventory, layout, responsive, accessibility, and Do/Don't sections. Record that the queue uses neutral surfaces, action blue, and text-first rows; omit unsupported historical tabs and metrics.

- [ ] **Step 3: Add only component-level tokens that are genuinely new**

Add DTCG tokens for:

- `component.admin-review.summary-card-min-height = 112px`
- `component.admin-review.queue-row-min-height = 72px`
- `component.admin-review.mobile-breakpoint = 720px`

Reuse the existing colour, spacing, radius, and typography tokens for every other decision.

- [ ] **Step 4: Lint the design artifact**

Run: `python3 .claude/skills/anydesign/scripts/lint_design_md.py apps/web/design/design.md`

Expected: all checks pass with 0 failures.

- [ ] **Step 5: Validate the token JSON**

Run: `python3 -m json.tool apps/web/design/design-tokens.json >/dev/null`

Expected: exit 0.

- [ ] **Step 6: Commit the design update**

```bash
git add apps/web/design/design.md apps/web/design/design-tokens.json
git commit -m "doc: extend design system for admin reviews"
```

### Task 2: Add the Existing-Endpoint Admin Client

**Files:**
- Create: `apps/web/lib/admin-api.test.ts`
- Create: `apps/web/lib/admin-api.ts`

**Interfaces:**
- Consumes: `fetch`, API base URL, Supabase access token, page, per-page count, and `ApprovalSort`.
- Produces: `ApprovalSort`, `AdminApprovalPackage`, `ApprovalListResponse`, `AdminUser`, `AdminApiError`, `fetchPendingApprovals(fetcher, apiUrl, token, query)`, and `fetchAdminUsers(fetcher, apiUrl, token)`.

- [ ] **Step 1: Write failing request tests**

In `admin-api.test.ts`, assert that `fetchPendingApprovals` requests:

`/approvals?page=2&per_page=20&sort=submitted_at_desc`

with `Authorization: Bearer token`, maps the returned `data` and `meta`, and never adds unsupported query parameters.

- [ ] **Step 2: Write failing error tests**

Assert that 401 throws `AdminApiError` with `kind === "unauthenticated"`, 403 uses `kind === "forbidden"`, and another non-OK response uses `kind === "request"`. Assert invalid JSON cannot escape as a raw parsing exception.

- [ ] **Step 3: Write the optional-user test**

Assert `fetchAdminUsers` requests `/users` with the bearer token and maps only `id`, `username`, and `email` needed for labels.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `node --import tsx --test lib/admin-api.test.ts`

Expected: FAIL because `admin-api.ts` or its exports do not exist.

- [ ] **Step 5: Implement the minimum typed client**

Create these signatures:

```ts
export type ApprovalSort = "submitted_at_asc" | "submitted_at_desc";
export class AdminApiError extends Error {
  constructor(message: string, public readonly kind: "unauthenticated" | "forbidden" | "request", public readonly status: number);
}
export async function fetchPendingApprovals(fetcher: typeof fetch, apiUrl: string, token: string, query: { page: number; perPage: number; sort: ApprovalSort }): Promise<ApprovalListResponse>;
export async function fetchAdminUsers(fetcher: typeof fetch, apiUrl: string, token: string): Promise<AdminUser[]>;
```

Use `URLSearchParams`, strip one trailing slash from `apiUrl`, and return a friendly request error when the response body is absent or malformed.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `node --import tsx --test lib/admin-api.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit the client**

```bash
git add apps/web/lib/admin-api.ts apps/web/lib/admin-api.test.ts
git commit -m "feat: add admin review queue client"
```

### Task 3: Add Pure Dashboard Models and the Review Route Contract

**Files:**
- Create: `apps/web/lib/admin-review.test.ts`
- Create: `apps/web/lib/admin-review.ts`
- Modify: `apps/web/lib/routes.test.ts`
- Modify: `apps/web/lib/routes.ts`

**Interfaces:**
- Consumes: API package/user shapes, ISO timestamps, pagination metadata, and package IDs.
- Produces: `creatorLabel(creatorId, users)`, `formatWaitingAge(submittedAt, now)`, `formatSubmittedAt(submittedAt)`, `formatAdminDestination(pkg)`, `formatAdminDuration(durationDays)`, `formatAdminPrice(priceAud)`, `approvalResultRange(meta, visibleCount)`, `requestSequenceIsCurrent(sequence, activeSequence)`, `optionalAdminUsers(request)`, and `adminApprovalRoute(packageId)`.

- [ ] **Step 1: Write failing fallback and formatter tests**

Assert:

- username wins over email local-part;
- email local-part wins over `Creator abcdef12`;
- null, invalid, and future submission times return `Not available`;
- 30 minutes, 5 hours, and 3 days produce concise singular/plural-safe labels;
- destination, duration, price, and result range tolerate null or empty values.

Assert `optionalAdminUsers(Promise.reject(...))` resolves to `[]` while a successful request preserves its users, so enrichment can never hide the queue.

- [ ] **Step 2: Write the stale-response test**

Assert `requestSequenceIsCurrent(3, 3)` is true and `(2, 3)` is false. This helper is the controller's only rule for accepting async results.

- [ ] **Step 3: Write the route test**

Assert `adminApprovalRoute("package/id")` returns `/admin/approvals/package%2Fid`.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `node --import tsx --test lib/admin-review.test.ts lib/routes.test.ts`

Expected: FAIL on missing helpers.

- [ ] **Step 5: Implement the pure helpers and route**

Keep all date math in milliseconds and accept `now` as `Date | string` for deterministic tests. Use `Intl.DateTimeFormat("en-AU", { dateStyle: "medium" })` and existing route encoding conventions.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --import tsx --test lib/admin-review.test.ts lib/routes.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit the models**

```bash
git add apps/web/lib/admin-review.ts apps/web/lib/admin-review.test.ts apps/web/lib/routes.ts apps/web/lib/routes.test.ts
git commit -m "feat: add admin review dashboard models"
```

### Task 4: Build the Dashboard View and Controller

**Files:**
- Create: `apps/web/components/admin/admin-review-dashboard.test.ts`
- Create: `apps/web/components/admin/admin-review-dashboard.tsx`
- Create: `apps/web/app/admin/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Task 2 API client, Task 3 helpers, Supabase browser session, `useRouter`, and Task 1 component tokens.
- Produces: default `AdminReviewDashboard` and exported pure `AdminReviewDashboardView(props)` rendered by `/admin`.

- [ ] **Step 1: Read the relevant Next.js 16 guides**

Read `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`, `04-linking-and-navigating.md`, `05-server-and-client-components.md`, and `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md` before adding the route or client controller.

- [ ] **Step 2: Write failing view-state tests**

Using `renderToStaticMarkup`, assert the pure view renders:

- skeletons plus `aria-busy` for loading;
- `All caught up` for an empty queue;
- `Administrator access required` and a marketplace link for forbidden;
- a `Try again` button and `role="alert"` for request failure.

- [ ] **Step 3: Write the ready-queue test**

Render two packages and assert:

- pending total and oldest-waiting values;
- title, destination, creator label, submitted date/age, duration, and AUD price;
- a table caption and scoped headers;
- a mobile-card region with the same values;
- `Review <package title>` links use `adminApprovalRoute`;
- no Approve or Reject control appears.

- [ ] **Step 4: Write controller-state tests around exported pure transitions**

Export small helpers `dashboardSessionAction(accessToken)`, `dashboardFailure(error)`, and `nextDashboardPage(currentPage, response)` from the component module. Assert:

- a missing token maps to redirect intent and a present token maps to load intent;
- unauthenticated maps to redirect intent;
- forbidden maps to the access state;
- request failure maps to retry state;
- an empty page above page 1 returns the preceding page;
- an empty first page remains page 1.

- [ ] **Step 5: Run the focused test and verify RED**

Run: `node --import tsx --test components/admin/admin-review-dashboard.test.ts`

Expected: FAIL because the dashboard component does not exist.

- [ ] **Step 6: Implement the pure view**

Implement:

```ts
export function AdminReviewDashboardView(props: AdminReviewDashboardViewProps): ReactNode;
```

The props fix the state contract to `status: "loading" | "ready" | "empty" | "forbidden" | "error"`, current packages and pagination metadata, sort, oldest timestamp, creator users, optional error message, and callbacks for sort, paging, refresh, and sign-out.

Use semantic headings, a labeled metrics section, a native sort select, buttons with 44-pixel minimum targets, table caption/headers, labeled mobile metadata, accessible review names, and no inline decision action.

- [ ] **Step 7: Implement the controller**

Implement the default component with:

- Supabase `getSession` and auth-state redirect behavior;
- page size `20`;
- default `submitted_at_asc`;
- one current-page request and a one-row global-oldest request unless the table query is already page 1 oldest-first;
- user enrichment only after the approval gate succeeds;
- request-sequence acceptance guard;
- sort reset to page 1;
- refresh preserving sort/page;
- empty-last-page correction;
- sign-out returning to `/login`.

- [ ] **Step 8: Add the thin route**

`apps/web/app/admin/page.tsx` imports and renders `AdminReviewDashboard` without duplicating client logic.

- [ ] **Step 9: Add token-grounded styles**

Use existing CSS variables for all colours, type, spacing, radius, and focus. Add `.admin-review-*` selectors for the header, shell, metrics, controls, desktop table, mobile cards, empty/error states, and the 720-pixel table-to-card switch. Do not copy raw colours from the wireframe.

- [ ] **Step 10: Run focused tests and verify GREEN**

Run: `node --import tsx --test components/admin/admin-review-dashboard.test.ts lib/admin-api.test.ts lib/admin-review.test.ts lib/routes.test.ts`

Expected: all focused tests pass.

- [ ] **Step 11: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: typecheck passes; lint has 0 errors and no new warnings.

- [ ] **Step 12: Commit the dashboard**

```bash
git add apps/web/components/admin/admin-review-dashboard.tsx apps/web/components/admin/admin-review-dashboard.test.ts apps/web/app/admin/page.tsx apps/web/app/globals.css
git commit -m "feat: add admin review dashboard"
```

### Task 5: Verify the Complete Frontend Slice

**Files:**
- Modify only if verification exposes a dashboard defect.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: evidence that the dashboard satisfies the spec without backend changes.

- [ ] **Step 1: Run the complete web suite**

Run: `npm test`

Expected: all tests pass with 0 failures.

- [ ] **Step 2: Run required web gates**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0; lint has 0 errors and no new warnings.

- [ ] **Step 3: Run API regression checks without modifying API files**

Run the repository API test suite and `python -c "from app.main import app; print(app.title)"` using the configured project interpreter.

Expected: all API tests pass and the import prints `FastAPI`.

- [ ] **Step 4: Run repository integrity checks**

Run design lint, JSON validation, `git diff --check`, and the repository forbidden-term scan.

Expected: all exit 0 and no forbidden addition is printed.

- [ ] **Step 5: Run desktop browser QA**

At `/admin`, verify with a real admin session:

- real queue and totals load;
- oldest/newest sorting resets to page 1;
- pagination range and controls match metadata;
- refresh retains controls;
- review links have the correct destination;
- no approve/reject action is present.

- [ ] **Step 6: Run mobile browser QA**

At a viewport narrower than 720 pixels, verify the table is absent, cards contain the same labeled information, controls remain at least 44 pixels, and the page has no horizontal overflow.

- [ ] **Step 7: Verify scope and branch state**

Run: `git diff origin/develop --name-only` and `git status --short --branch`.

Expected: no file under `apps/api/` or `supabase/` changed; worktree is clean after task commits.

- [ ] **Step 8: Request whole-branch code review**

Ask a fresh reviewer to compare the branch against this plan and the design spec, focusing on access handling, stale requests, accessibility, responsive parity, and backend-scope violations. Fix every Critical or Important finding and rerun affected verification.

- [ ] **Step 9: Report completion without pushing**

Report commit hashes, verification evidence, local URL, and the known reserved review-route dependency. Ask for explicit approval before any push.
