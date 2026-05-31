# API

Phase 1 backend for the Influencer Travel Marketplace. **Flask 3.0.3** prototype covering Supabase auth and basic user admin.

Phase 2 (planned): full migration to FastAPI before the first `/ai/*` endpoint lands. See [docs/adr/0001-flask-now-fastapi-for-ai.md](docs/adr/0001-flask-now-fastapi-for-ai.md).

## Endpoints (Phase 1)
- `GET /health`
- `GET /users`
- `PATCH /users/<id>`
