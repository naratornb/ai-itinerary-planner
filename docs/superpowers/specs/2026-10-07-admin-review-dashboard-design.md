# Admin Review Dashboard

## Goal

Give administrators a focused landing page for finding packages that are waiting for review. The page must use only existing API contracts, make the oldest work visible, and send each row to a dedicated review route without allowing approve or reject actions from the queue.

## User outcome

An administrator can open `/admin`, see how much review work is waiting, understand which submission has waited longest, sort the queue, and open one package for review. A creator or signed-out visitor cannot mistake this page for a creator dashboard.

## Constraints

- Frontend only. Do not modify the FastAPI service, `apps/api/openapi.yaml`, Supabase migrations, or RLS policies.
- Use the existing `GET /approvals` endpoint as the source of truth for queue membership and totals.
- Use the existing `GET /users` endpoint only after `GET /approvals` confirms the session is an administrator. User data enriches creator labels but does not control access.
- Do not invent approved, rejected, or historical metrics that the existing contracts cannot return.
- Reuse installed dependencies and the existing design system. Add no dependency.
- Keep approve and reject actions out of the dashboard. They belong on the separate review page.

## Scope

### Included

- New `/admin` route.
- Admin-specific page header and review queue content.
- Pending-review total.
- Oldest-waiting age derived from the earliest submitted package.
- Oldest-first and newest-first sorting supported by the existing API.
- Paginated package table with package, destination, creator, submitted time, duration, price, and `Review` action.
- Optional creator-name enrichment from the existing users endpoint, with a short creator-ID fallback.
- Loading, empty, authentication, authorization, upstream-error, and retry states.
- Responsive table-to-card adaptation.
- Navigation contract from `Review` to `/admin/approvals/[packageId]`.
- Focused frontend tests and updates to the committed design documentation.

### Excluded

- The package review-detail screen itself. It is the next frontend slice and owns the approve/reject interaction.
- Approval history, approved-today totals, rejected totals, and all-status tabs.
- Search across all submissions; the current approvals endpoint has no search parameter.
- User management changes.
- Backend, contract, database, or permission changes.
- Notifications, assignments, bulk decisions, and reviewer analytics.

The dashboard may link to the reserved review route while the two frontend slices are developed on the same feature branch. The branch is not ready for integration until the destination route exists or the action is temporarily unavailable in the reviewed build.

## Information architecture

The supplied wireframe is an information reference, not a visual target. The dashboard keeps its clear hierarchy while adopting the current product system.

1. **Admin header**
   - Product identity on the left.
   - `Admin` context label so the surface cannot be confused with the creator workspace.
   - Existing profile/sign-out affordance on the right where practical.
2. **Page introduction**
   - `Review dashboard` heading.
   - Short explanation that packages are ordered for review.
3. **Queue summary**
   - `Pending review`: `meta.total` from `GET /approvals`.
   - `Oldest waiting`: elapsed time from the oldest non-null `submitted_at`, or `Not available`.
4. **Queue controls**
   - Sort select: `Oldest first` and `Newest first`.
   - Refresh action.
   - Result range text, for example `Showing 1–20 of 37`.
5. **Review queue**
   - Desktop table.
   - Mobile stacked cards with the same information and action order.
6. **Pagination**
   - Previous and next controls based on API pagination metadata.

## Visual direction

- Use the existing neutral work surface: subtle page background, white cards, restrained borders, and dark primary text.
- Use the action-blue token for `Review`, focus rings, links, and selected controls.
- Keep the brand colour structural rather than using it as a queue-card fill.
- Use the warning token sparingly for long waiting time, not as a default pending colour.
- Metric cards are quiet summaries, not oversized analytics tiles.
- Preserve the existing spacing scale, 44-pixel minimum controls, 12-pixel card radius, and current typography.
- At narrow widths, remove the tabular grid rather than forcing horizontal scrolling for the primary workflow.

Before implementation, the `anydesign` workflow will translate the reference into updates to `apps/web/design/design.md` and `apps/web/design/design-tokens.json`. Implementation must consume those committed decisions instead of introducing unrelated hard-coded values.

## Frontend architecture

### Route

`apps/web/app/admin/page.tsx` is a thin route that renders the dashboard component.

### Feature component

`apps/web/components/admin/admin-review-dashboard.tsx` owns:

- session acquisition;
- dashboard state;
- sort and page controls;
- loading, empty, forbidden, and retry presentation;
- creator-label fallback;
- desktop and mobile queue rendering.

The component does not construct API URLs or decode response error bodies itself.

### API module

`apps/web/lib/admin-api.ts` owns:

- typed approval-list and pagination responses;
- `fetchPendingApprovals`;
- optional `fetchAdminUsers` enrichment;
- 401, 403, and generic failure mapping;
- URL construction and bearer-token headers.

The existing creator API module remains creator-focused and is not expanded with administrator queue behavior.

### Route helper

The admin review-detail path is generated by a small helper in the existing route module, not assembled in table JSX.

## Data flow

1. Read the current Supabase session.
2. With no access token, replace the route with `/login`.
3. Request the current queue page from `GET /approvals?page=<page>&per_page=20&sort=<sort>`.
4. Treat a successful response as the authorization gate.
5. On success, request user data for creator-name enrichment. Failure here is non-blocking.
6. Unless the table request is already page 1 in oldest-first order, make a one-row oldest-first request for a global `Oldest waiting` value. The total may be read from either successful approval response.
7. Render queue data and pagination metadata.
8. Changing sort resets to page 1 and reloads the list.
9. Refresh repeats the active request without discarding the current sort or page.

Requests use an active/cancelled guard so a late response cannot replace newer sort or page state.

## Display rules

- Creator label priority: matched username, matched email local part, then `Creator <first 8 ID characters>`.
- Destination: join city and country when available; otherwise show the available value or `Not provided`.
- Submitted time: absolute local date plus a concise elapsed label.
- Duration: integer day count or `Not provided`.
- Price: AUD with no fractional digits.
- Status is not a table column because every row is `pending_review` by contract.
- Missing cover media does not create a placeholder image column; the queue remains text-first.

## State and error handling

| State | Behavior |
| --- | --- |
| Session missing | Replace with `/login` |
| Initial loading | Stable skeleton for metrics and rows, with `aria-busy` |
| Empty queue | `All caught up` message and no disabled table shell |
| 401 | Replace with `/login` |
| 403 | Dedicated `Administrator access required` state with a link back to the marketplace |
| Approval request failure | Inline error summary and `Try again` |
| User enrichment failure | Keep the queue and use creator-ID fallbacks |
| Page becomes empty after refresh | Move to the preceding valid page once, then reload |

## Accessibility

- One page-level `h1` and correctly nested section headings.
- The metric region has an accessible label.
- Native select and button controls with visible focus rings.
- Desktop table includes a caption available to assistive technology and scoped column headings.
- Mobile cards retain explicit labels instead of relying on column position.
- Loading and refresh completion use polite status announcements; failures use `role="alert"`.
- `Review` links include the package title in their accessible name.
- Colour is never the only indicator of waiting age or request state.

## Responsive behavior

- Desktop: two summary cards followed by a full-width table.
- Tablet: table keeps essential columns and moves secondary metadata under the title.
- Mobile: each package becomes a bordered card; title and `Review` remain first-class, followed by labeled metadata.
- Page padding follows existing breakpoints and never requires full-page horizontal scrolling.

## Testing

Focused runnable checks must cover:

1. Approval API requests include the bearer token and encode page, page size, and sort.
2. API errors distinguish 401, 403, and generic failures.
3. User enrichment failure does not fail the queue.
4. Creator-label fallback is deterministic.
5. Pending total and oldest-waiting display use real response data.
6. Empty, forbidden, and request-error states render the correct action.
7. Sort changes reset pagination.
8. Each `Review` link uses `/admin/approvals/[packageId]` and includes the package title in its accessible name.
9. Desktop and mobile presentations contain the same package information.

Before commit, run the repository-required web lint and build gates, the frontend test suite, API tests and import smoke-check, design-document lint, forbidden-term scan, and browser QA at desktop and mobile widths.

## Success criteria

- An administrator sees the real pending queue at `/admin`.
- Queue totals and waiting age never depend on fixture data.
- The oldest submission is discoverable by default.
- A creator or signed-out visitor receives an intentional access outcome.
- Missing user enrichment cannot hide review work.
- The dashboard contains no decision action.
- The implementation changes no backend, OpenAPI, migration, or database file.
