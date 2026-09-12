# Frontend API usage audit

Audited 12 September 2026 against the current frontend source and [Swagger contract](../apps/api/openapi.yaml). This is a static call-site audit, not a live-traffic or payload-conformance test. Tests alone do not count as frontend usage.

The frontend still uses **15 of 29 documented operations**; **14 have no frontend caller**. Counts treat each HTTP method and path as one operation and exclude infrastructure routes such as `/health` and documentation routes.

**This count is unchanged by the package-save-submit backend work** (contract version 2.2.0 → 2.3.0). `POST /packages` and `PUT /packages/{package_id}` gained new request/response fields and `POST /packages/{package_id}/submit` gained no new backend behavior visible to a caller that never calls it, but `apps/web` was not touched in that change, so `saveDraft` still only sends title, price, and day titles/summaries, and no frontend code calls `/submit` yet. The richer save/submit integration described in [frontend-package-save-submit-handover.md](frontend-package-save-submit-handover.md) is a planned FE follow-up, not something already wired up — it is not counted as usage here until `apps/web` actually calls it.

## Used endpoints

“Editor” means `/packages/editor/[packageId]`.

| Endpoint | Page / module | Usage |
| --- | --- | --- |
| `GET /packages` | `/dashboard` → `DashboardScreen` | Load creator packages with `per_page=100` |
| `POST /packages` | `/packages/new` → `BuilderScreen`; `/packages/new/ai` → `AIWizardScreen` | Create manual or AI-generated package |
| `GET /packages/{package_id}` | Editor → `PackageEditorScreen` | Load package for editing |
| `PUT /packages/{package_id}` | Editor → `ItineraryEditor` | Save title, price, and day titles/summaries |
| `GET /media/{package_id}` | Editor → `ItineraryEditor` | Load package photos |
| `POST /media/upload` | Editor → `ItineraryEditor` | Upload photos |
| `DELETE /media/{media_id}` | Editor → `ItineraryEditor` | Remove uploaded photos |
| `POST /ai/recommend` | `/packages/new/ai` → `AIWizardScreen` | Generate itinerary through Next.js `/api/ai/recommend` proxy |
| `GET /marketplace/packages` | `/marketplace` → `MarketplaceScreen` | Load public listings with `per_page=100`; `/` redirects here |
| `GET /marketplace/packages/{package_id}` | `/marketplace/packages/[packageId]` → `MarketplaceDetailScreen` | Load public package details |
| `GET /marketplace/search` | `/marketplace` → `MarketplaceScreen` | Search suggestions and submitted searches |
| `POST /ai/copilot/{package_id}/turns` | Editor → `CopilotPanel` | Send chat prompts and receive suggestions |
| `PATCH /ai/copilot/{package_id}/turns/{turn_id}/items/{item_id}` | Editor → `CopilotPanel` | Accept or dismiss suggestions |
| `GET /users` | `/users` | Load Auth users; added to Swagger in this update |
| `PATCH /users/{user_id}` | `/users` | Edit email, status, or creation-date metadata; added to Swagger in this update |

Call implementations: [creator-api.ts](../apps/web/lib/creator-api.ts), [marketplace-api.ts](../apps/web/lib/marketplace-api.ts), [copilot-client.ts](../apps/web/lib/copilot-client.ts), [recommend proxy](../apps/web/app/api/ai/recommend/route.ts), and [users page](../apps/web/app/users/page.tsx).

Page wiring: [route-screens.tsx](../apps/web/components/route-screens.tsx), [migrated-screens.tsx](../apps/web/components/migrated-screens.tsx), [package-editor-screen.tsx](../apps/web/components/package-editor-screen.tsx), [itinerary-editor.tsx](../apps/web/components/itinerary-editor.tsx), [marketplace-detail-screen.tsx](../apps/web/components/marketplace-detail-screen.tsx), and [copilot-panel.tsx](../apps/web/components/copilot/copilot-panel.tsx).

## Documented endpoints without frontend callers

| Module | Unused endpoints | Current frontend behavior |
| --- | --- | --- |
| Authentication (3) | `POST /auth/login`; `GET /auth/me`; `POST /auth/logout` | Supabase SDK handles authentication and sessions; navigation reads profiles directly |
| Package lifecycle (2) | `DELETE /packages/{package_id}`; `POST /packages/{package_id}/submit` | No package deletion or submission API integration |
| Approvals (4) | `GET /approvals`; `POST /approvals/{package_id}/approve`; `POST /approvals/{package_id}/reject`; `POST /approvals/{package_id}/publish` | No approval workflow connected |
| AI suggestions (4) | `POST /ai/suggest`; `GET /ai/suggestions/{package_id}`; `PATCH /ai/suggestions/{suggestion_id}/accept`; `PATCH /ai/suggestions/{suggestion_id}/dismiss` | Editor uses separate Co-Pilot endpoints |
| Co-Pilot history (1) | `GET /ai/copilot/{package_id}/turns` | Chat sends new turns without loading persisted history |

Unused operations remain in Swagger because they are backend capabilities, even without a frontend caller.

## Other frontend integrations

| Endpoint / service | Page / module | Status |
| --- | --- | --- |
| `GET /dashboard/stats` | `fetchDashboardStats` in `creator-api.ts` | Helper and test only; no page caller, backend route, or Swagger operation |
| `POST /api/ai/validate` | Editor | Next.js route calling Gemini; outside FastAPI |
| `POST /api/ai/generate-content` | Editor | Next.js route calling Gemini; outside FastAPI |
| Supabase Auth | Login, registration, password reset, session handling, logout | Direct SDK calls |
| Supabase database: `profiles` | `TopNav`, `CreatorNav` | Direct profile queries |
| Supabase database: `activities` | Editor activity search | Direct activity query |

The Next.js `/api/ai/recommend` route proxies FastAPI and is counted under `POST /ai/recommend` above. The other Next.js AI routes do not proxy documented FastAPI endpoints.

## Remaining integration gaps

- **Publishing is UI-only.** `handlePublish` changes local state and displays a notice; it does not call submit or publish.
- **Saving edits is partial.** `saveDraft` sends title, price, and day titles/summaries. Edited timeline items, hotels, and flights remain local.
- **Co-Pilot history is not restored.** The history endpoint has no client integration.
- **User-management defaults differ.** `/users` defaults to `http://localhost:5001`; other backend clients default to `http://localhost:8000`. Setting `NEXT_PUBLIC_API_URL` overrides these defaults.
- **User management checks authentication only.** The current backend handlers use `require_user`, without an admin-role check. The contract records current behavior; authorization changes are outside this documentation update.
- **User update responses differ from list entries.** Listing returns normalized users, while updating returns upstream Supabase JSON unchanged. `createdAt` updates user metadata, not the underlying Auth creation timestamp.

## Swagger changes accompanying this audit

- Added `GET /users` and `PATCH /users/{user_id}`, with their current request, response, and authentication behavior.
- Corrected server URLs to unprefixed paths, matching current FastAPI registration; `/v1` remains deferred. Local development is the first server; the production origin remains a placeholder.
- Corrected the backend hosting description to the Vercel target and documented the user-management error-shape exception.
- Bumped `info.version` from `2.1.0` to `2.2.0` for the additive operations.
- Bumped `info.version` from `2.2.0` to `2.3.0` for the package-save-submit field additions (flight/hotel/activity/day fields, `package_component_id`, nullable catalog IDs, replace/omit/clear collection semantics). No frontend caller was changed alongside this bump.

This update documents existing behavior. It does not implement missing frontend flows, add the future dashboard endpoint, or change backend handlers.
