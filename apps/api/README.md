# API

Flask backend (Phase 1) for the Influencer Travel Marketplace. Handles Supabase auth and basic user admin.

> Phase 2 (planned): full migration to FastAPI before the first `/ai/*` endpoint. See [docs/adr/0001-flask-now-fastapi-for-ai.md](docs/adr/0001-flask-now-fastapi-for-ai.md).

## Run

Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the root `.env` (see repo README).

```sh
pip install -r requirements.txt
flask run --port 5001
```

Listens on `http://localhost:5001`.

## Endpoints

- `GET /health` — liveness check
- `GET /users` — list Supabase auth users (service-role)
- `PATCH /users/<id>` — update email / status / role
