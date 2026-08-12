# API

FastAPI backend for the Influencer Travel Marketplace. Talks to Supabase over PostgREST/Auth HTTP.

## Layout

```
app/
├── main.py            # FastAPI(), CORS, /health + /openapi.yaml + /docs-ui, include_router()
├── core.py            # env config, Supabase headers, require_user() auth dependency
├── marketplace/router.py
└── users/router.py
tests/
```

## Run

Reads `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) from the root `.env`.

```sh
pip install -r requirements-dev.txt
uvicorn app.main:app --port 8000   # from apps/api
pytest
```

## Endpoints

- `GET /health` — liveness check
- `GET /openapi.yaml` — the canonical API contract
- `GET /docs-ui` — Swagger UI over the contract
- `GET /marketplace/packages/{package_id}` — public package detail
- `GET /users` — list Supabase auth users (service-role)
- `PATCH /users/{user_id}` — update email / status

Conventions for this service: [AGENTS.md](AGENTS.md).
