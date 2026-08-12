# API smoke test collection

A Bruno collection that smoke tests every currently implemented API endpoint.

## Prerequisites

- Copy `.env.example` to `.env` and fill it in. You need a real Supabase Auth user —
  the seeded creator rows are DB-only and cannot log in.
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

## Folders

| Folder | What it does |
| --- | --- |
| `00-auth` | Logs in and captures the access token |
| `01-system` | Health, OpenAPI spec, docs UI |
| `02-marketplace` | Public package detail (no auth) |
| `03-packages` | Full create -> get -> update -> delete lifecycle, cleans up after itself |
| `04-users` | List users |

## Not covered

- Marketplace list and search endpoints — not implemented yet.
- `PATCH /users/{user_id}` — mutates a real auth account with no clean rollback.

## CI

Not wired into `.github/workflows/ci.yml`: it needs live Supabase credentials and a
running API. A future deploy-time smoke job can point it at a deployed environment with
`--env-var host-api=<url>`.
