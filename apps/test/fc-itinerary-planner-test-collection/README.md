# API smoke test collection

A Bruno collection that smoke tests every currently implemented API endpoint.

## Prerequisites

- Env comes from the single repo-root `.env` (see the root `.env.example` for the smoke
  keys). This collection reads it through a symlink — create it once on a fresh clone:
  `ln -s ../../../.env .env` (from this folder). You need a real Supabase Auth user for
  `SMOKE_EMAIL` — the seeded creator rows are DB-only and cannot log in.
- An admin account (`SMOKE_ADMIN_EMAIL` / `SMOKE_ADMIN_PASSWORD`) whose `profiles.role`
  is `admin`. `05-approvals` fails fast if it is not.
- A Supabase Storage bucket named `package-media` — `07-media` uploads to it.
- API running locally: from `apps/api` run `.venv/bin/uvicorn app.main:app --port 8000`
  (it reads the repo-root `.env`). That root `.env` needs a non-empty
  `SUPABASE_SERVICE_ROLE_KEY` — without it every authenticated route returns
  `500 Supabase admin credentials not configured`, and only `01-system` and
  `02-marketplace` will pass.

## Run headless

```
cd apps/test/fc-itinerary-planner-test-collection
npx @usebruno/cli run --env main-env --bail
```

Exit code 0 = pass, non-zero = a failed assertion. That is the CI contract.

## Auth

`00-auth/login` captures the Supabase access token into the `access-token` runtime
variable, so it must run first in any session. Each authenticated request declares its
own bearer auth referencing `{{access-token}}` rather than inheriting it from the
collection — the Bruno GUI (4.0.0) does not resolve collection-level inherited auth, so
inheriting silently sends no `Authorization` header and every call 401s.

Three tokens are in play. `access-token` comes from the direct Supabase login and is the
main workhorse — every authenticated folder uses it. `api-access-token` comes from
`POST /auth/login` (the API's own auth surface) and is used only by `/auth/me` and the
final logout. `admin-access-token` comes from `00-auth/admin-login`, which logs in
directly against Supabase (like `login`) rather than through `POST /auth/login`, so the
admin-only approvals requests do not depend on the API auth surface being healthy;
whether the account really is an admin is verified by `05-approvals` itself
(`approve-not-found` expects admin 404, `list-forbidden` expects non-admin 403).

A collection-level `before-request` script (in `opencollection.yml`) auto-refreshes any
of the three tokens that is missing or within 120s of its JWT `exp`. CLI runs finish
well inside a token's lifetime, but GUI runs are slow enough for tokens captured in
`00-auth` to expire mid-run — without the refresh, everything from `06-ai` onward 401s.
The script skips the login requests themselves so they still exercise the real paths.

## Folders

| Folder | What it does |
| --- | --- |
| `00-auth` | Supabase login, API login, admin login, `/auth/me` — captures all three tokens |
| `01-system` | Health, OpenAPI spec, docs UI |
| `02-marketplace` | Public package detail, list, search, short-query error (no auth) |
| `03-packages` | Full create -> get -> update -> delete lifecycle plus a no-token 401 check, cleans up after itself |
| `04-users` | List users |
| `05-approvals` | Admin-gate checks (404/403) first so a bad admin account fails before creating state, then submit -> list pending -> reject lifecycle and a 409 publish negative |
| `06-ai` | Draft + AI suggestion lifecycle (suggest, list, accept, dismiss), cleans up |
| `07-media` | Upload -> list -> delete media on a throwaway draft, cleans up |
| `08-logout` | `POST /auth/logout` — runs last on purpose: Supabase logout may sign out all of the smoke user's sessions, and nothing depends on tokens after it |

## Residue

Each run deliberately leaves one private **rejected** "Smoke Test" package behind:
submitted packages cannot be deleted (DELETE requires `draft`). It is not public, so it
never reaches the marketplace.

A run that bails partway can also leave a `pending_review` "Smoke Test" package (if it
stopped between submit and reject — an admin can reject it by hand) or draft packages
titled "Smoke Test AI Draft" / "Smoke Test Media Draft" (deletable via the API or the
creator dashboard).

## Not covered

- `PATCH /users/{user_id}` — mutates a real auth account with no clean rollback.

## CI

Not wired into `.github/workflows/ci.yml`: it needs live Supabase credentials and a
running API. A future deploy-time smoke job can point it at a deployed environment with
`--env-var host-api=<url>`.
