# API

Flask backend (Phase 1) for the Influencer Travel Marketplace. Handles Supabase auth and basic user admin.

> Phase 2 (planned): full migration to FastAPI before the first `/ai/*` endpoint. See [docs/adr/0001-flask-now-fastapi-for-ai.md](docs/adr/0001-flask-now-fastapi-for-ai.md).

## Run

Via the root Docker Compose stack (recommended):

```sh
docker compose up -d api          # from repo root, after root .env is set up
```

Standalone for development:

```sh
pip install -r requirements.txt
SUPABASE_URL=http://localhost:8000 \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
python app.py
```

Listens on `http://localhost:5001` in Docker, `http://localhost:5000` standalone.

## Endpoints

- `GET /health` — liveness check
- `GET /users` — list Supabase auth users (service-role)
- `PATCH /users/<id>` — update email / status / role
