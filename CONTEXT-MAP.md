# Context Map

This repo has multiple bounded contexts. Each has its own `CONTEXT.md` glossary and (when relevant) its own `docs/adr/`.

| Context | Path | Stack | Responsibility |
| --- | --- | --- | --- |
| API | [apps/api/](apps/api/) | Python / FastAPI | Itinerary generation, persistence, AI orchestration |
| Web | [apps/web/](apps/web/) | Next.js / TypeScript | User-facing planner UI |
| Infra | repo root | Docker Compose / Supabase | Self-hosted Supabase stack + reverse proxies |

System-wide ADRs live in [docs/adr/](docs/adr/) once created. Context-specific ADRs live under each context's own `docs/adr/`.

`CONTEXT.md` files are created lazily by `/grill-with-docs` when domain terms get resolved — empty/absent is fine for now.
