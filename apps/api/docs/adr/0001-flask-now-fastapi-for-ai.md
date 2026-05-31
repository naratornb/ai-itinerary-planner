---
status: accepted
---

# Phase the backend: Flask now, FastAPI before first AI route

Phase 1 (current): the backend is **Flask 3.0.3**, a working prototype covering Supabase auth and basic user admin. Phase 2 trigger: **before the first `/ai/*` endpoint lands**, the entire app is ported to **FastAPI** in a single focused migration — async behaviour fits the LangChain RAG / GPT-4o pipeline (NFR-P-101: < 10s end-to-end) and Pydantic validation matches the strictly-typed contracts in `docs/openapi.yaml`.

## Considered options

- **Stay Flask forever.** Rejected — sync request handling makes the < 10s RAG NFR brittle once concurrent users hit the same endpoint.
- **Hybrid (Flask + FastAPI side-by-side).** Rejected — duplicate JWT / CORS / error-handling and two mental models for new contributors. The marginal cost of full migration at the right moment is cheaper than ongoing duplication.
- **Migrate now, before any AI work.** Rejected — Flask is working, the Phase 1 surface is small, and the team needs to ship the current milestone before spending a sprint on infrastructure.

## Consequences

- `docs/openapi.yaml` describes the **Phase 2** target (FastAPI, port 8000, `/v1` prefix). Phase 1 code runs on port 5000 with no prefix. New Flask endpoints should adopt the *contract shape* from the spec (paths, payloads, JWT auth, AUD-cents money) even though the framework differs.
- Until migration: no async-only libraries (e.g. `httpx.AsyncClient`, `asyncpg`) get introduced. New deps must work under WSGI.
- An issue tagged `phase-2-migration` should be created when the first `/ai/*` work is queued, blocking that work until the port lands.
