# AGENTS.md — FastAPI Service Conventions

Rules for any agent (or engineer) writing, reviewing, or refactoring code in this FastAPI service. Follow these defaults unless existing code or a comment explicitly overrides them.

## Repo overrides

These take precedence over the generic rules below.

- **Migrations**: go through `supabase/migrations/` (append-only, RLS policies in the same migration), **not** Alembic.
- **Database access**: raw PostgREST over HTTP via `requests` in sync `def` handlers — compliant with the Async rules (no async ORM here), so the async-ORM guidance doesn't apply.
- **Versioning**: the `/v1` prefix is deferred (ADR Phase-2 target); routers mount unprefixed for now.
- **Deferred chores**: `mypy` in CI, and structured-logging / request-ID middleware, are tracked as separate chores — not required yet.

## Project Structure

Organize by domain/feature, not by technical layer — each feature owns its router, schemas, and logic.

```
app/
├── main.py            # FastAPI() instance, middleware, include_router() — nothing else
├── core/               # settings, security helpers, db session factory, logging config
├── api/
│   └── v1/
│       ├── users/      # router.py, schemas.py, service.py, models.py
│       └── orders/     # same shape, repeated per domain
└── tests/
    ├── users/
    └── orders/
```

- Keep `main.py` thin: instantiate the app, mount middleware, `include_router()` — nothing else.
- Don't let a router file grow past ~300 lines; split by sub-resource before it does.

## Async vs. Sync
- Use `async def` only where the function `await`s non-blocking I/O (async DB driver, `httpx.AsyncClient`, async cache).
- Use plain `def` for handlers built on blocking/sync libraries — FastAPI runs these in a threadpool automatically. Don't fake async by wrapping sync calls in `async def`.
- Never call a blocking function (sync DB driver, `requests`, `time.sleep`) inside `async def`. Offload with `run_in_threadpool` / `asyncio.to_thread`, or make the route sync.

## Pydantic & Schemas
- Pydantic v2 only. Configure models with `model_config = ConfigDict(...)`, not the old `class Config`.
- One schema per purpose: `XCreate` / `XUpdate` (input) / `XRead` (output). Never return an ORM/DB model directly from a route.
- Set `response_model` on every route — response shape and optional/null handling should be explicit, not incidental.
- Put validation in the schema (`Field(...)`, `@field_validator`), not scattered through the route body.

## Dependency Injection & Lifecycle
- Use `Depends()` for anything reused across routes: DB session, current user/auth, pagination, feature flags.
- Prefer small, composable dependencies over one dependency that does everything.
- Manage startup/shutdown (DB pool, cache client, workers) with the `lifespan` context manager. `@app.on_event` is deprecated — don't use it.

## Routing & API Design
- One `APIRouter` per feature, mounted in `main.py` with an explicit `prefix` and `tags`.
- Version from day one: mount under `/api/v1`.
- Set an explicit `status_code` per route (`201` create, `204` delete, etc.) instead of relying on the `200` default.
- Type path/query parameters (`int`, `UUID`, `Enum`) for free validation instead of parsing strings by hand.

## Error Handling
- Raise `HTTPException` for expected failures (`404`, `409`, `422`); never let raw internal exceptions or stack traces reach the client.
- Register `@app.exception_handler(...)` for domain exceptions so every error response shares one shape.
- Trust Pydantic's validation and fail fast — don't re-check types/values manually in the route.

## Database
- Use an async ORM/driver on the request path (SQLAlchemy 2.0 async style, or SQLModel). Don't mix sync sessions into async routes.
- One session per request via a `Depends()` dependency; always commit/rollback and close in a `finally` or context manager — never share a session across requests.
- Migrations go through Alembic only; never hand-edit schema in a running environment.
- Watch for N+1 queries — eager-load (`selectinload` / `joinedload`) relationships the response actually needs.

## Security
- Load config/secrets via `pydantic-settings` `BaseSettings` reading environment variables. Never hardcode secrets; never commit `.env`.
- Hash passwords with a strong algorithm (argon2 or bcrypt, e.g. via `passlib` or `argon2-cffi`) — never store or log plaintext credentials.
- Auth via `fastapi.security` (OAuth2 + JWT); verify and expire tokens server-side, don't trust client-supplied claims.
- Configure `CORSMiddleware` with an explicit origin allow-list — never `allow_origins=["*"]` together with `allow_credentials=True`.
- Rate-limit public and auth endpoints (`slowapi` + Redis, or at the reverse proxy).

## Background & Long-Running Work
- `BackgroundTasks` is only for short, non-blocking follow-ups (send an email, write a log) that don't need retries.
- Use a real task queue (Celery, RQ, Arq) for anything long-running, retryable, or scheduled.

## Testing
- `pytest` + `httpx.AsyncClient(transport=ASGITransport(app=app), ...)` (or `TestClient`) against the app instance.
- Override dependencies via `app.dependency_overrides` for DB/auth in tests — never hit real infra or third-party APIs.
- Cover schema validation, service/business logic, and route integration as separate test layers.

## Code Quality & Tooling
- Type-hint every function signature; run `mypy` in CI.
- Lint and format with `ruff` (covers linting + formatting; add `black`/`isort` only if the repo already uses them).
- Keep route handlers thin: parse/validate → call a `service`/`crud` function → return. Business logic doesn't live in the route function.
- Pin dependency versions (`fastapi==...`, `pydantic==...`) in production requirements; don't float versions.

## Observability
- Structured (JSON) logs plus a request-ID middleware for traceability across a request's lifecycle.
- Expose a `/health` endpoint (useful for uptime checks and manual verification) — note that "liveness" is less meaningful on serverless since there's no long-lived process to probe.
- Keep OpenAPI metadata accurate (`response_model`, `Field(description=...)`, examples) — `/docs` and `/redoc` are the living API contract, not an afterthought.

## Deployment (Vercel)
- The app runs as a serverless function per request, not a long-running process — there is no persistent worker pool, no `gunicorn`/`uvicorn --workers`, and no local disk beyond `/tmp`.
- Entry point convention: expose the FastAPI instance where Vercel's Python runtime expects it (e.g. `api/index.py` importing `app` from `app/main.py`), and configure routing/build in `vercel.json`.
- Expect cold starts. Keep import-time work minimal — don't do heavy setup (loading large models, building big in-memory caches) at module scope if it can be deferred or avoided.
- Set env vars/secrets in the Vercel project dashboard (or `vercel env`), not in committed files. `pydantic-settings` `BaseSettings` still applies — it just reads from Vercel's injected env, not a `.env` file in prod.
- Respect the function timeout (varies by plan) — anything that might run long belongs in a queue/webhook, not directly in the request handler.
- Test dependency/version bumps via a Vercel preview deployment before promoting to production; don't float unpinned versions.

## Lifecycle & DB Connections (Serverless Adjustment)
- Don't rely on `lifespan` to build a long-lived DB connection pool — each invocation may be a fresh (or frozen/thawed) instance, and pools don't persist reliably across them.
- Use a serverless-aware connection strategy: a pooled/proxied DB endpoint (e.g. PgBouncer, Neon/Supabase pooled connection string, RDS Proxy) rather than opening many direct connections per invocation.
- Keep any module-level client (DB, HTTP) creation lazy and cheap; avoid assuming it survives between requests.

## Background Work (Serverless Adjustment)
- `BackgroundTasks` is unreliable here — the function can be frozen or torn down once the response is sent, before the task finishes.
- Use an external mechanism instead: Vercel Cron Jobs for scheduled work, or a queue/webhook service (e.g. QStash, Inngest, or a hosted queue) for anything that must complete independently of the request.
