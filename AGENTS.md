# AGENTS.md

Guidance for AI agents working in this repo. This file is read by Claude Code, Cursor, Codex, and other agent CLIs that follow the [agents.md](https://agents.md) convention.

## Forbidden terminology

**Never** write any of the following to files in this repo (code, docs, commit messages, PR descriptions, issue bodies):

| Forbidden | Use instead |
| --- | --- |
| `Flight Centre`, `Flightcentre` | "the Marketplace", or "the client" if a reference is unavoidable |
| `Flight Centre Influencer Marketplace` | `Influencer Travel Marketplace` |
| `QUT`, `QUT Group 51`, `Group 51` | omit entirely |
| `group51@qut.edu.au`, `qut.edu.au` | omit entirely — no contact email |
| `fc-marketplace.com` | use `api.example.com` until a real domain is decided |

A [`.githooks/pre-commit`](.githooks/pre-commit) script blocks staged changes that contain these. Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

Never bypass with `--no-verify` to ship a forbidden term. If a real reference is unavoidable (e.g. a test fixture for user-supplied input), discuss with the human first.

## Repo shape

Monorepo:
- `apps/api/` — Python **Flask** backend (Phase 1); FastAPI planned for Phase 2 before the first AI route — see [ADR-0001](apps/api/docs/adr/0001-flask-now-fastapi-for-ai.md). Glossary: [apps/api/CONTEXT.md](apps/api/CONTEXT.md)
- `apps/web/` — Next.js + TypeScript frontend (see [apps/web/CONTEXT.md](apps/web/CONTEXT.md))
- Docker Compose stack at root for Supabase self-hosting

Default branch: `main`. Active dev branch: `develop`.

## Git workflow

### Branch naming

`<type>/<short-kebab-summary>`, e.g.:
- `feat/itinerary-day-builder`
- `fix/web-auth-redirect`
- `chore/bump-postgrest`

Use the same `type` vocabulary as commits (below).

### Commit messages

`<type>: <imperative summary>`

- **Types**: `feat`, `fix`, `doc`, `refactor`, `test`, `chore`, `style`, `perf`, `build`, `ci`
- **No scope.** Do **not** use `type(scope):` parentheses — the type alone is enough. This applies to every type listed above.
- **Summary**: imperative mood, no trailing period, ≤72 chars

Examples (matches existing repo style):
- `doc: add relevant doc for reference`
- `feat: add /itineraries POST endpoint`
- `fix: handle 401 on dashboard route`
- `chore: bump postgres to 17.2`

For multi-line bodies, leave a blank line after the summary, then explain *why* (not what — the diff shows what).

### PR titles

Same format as commit summary.

## Agent skills

### Coding guidelines

Apply [`karpathy-guidelines`](https://github.com/andrejkarpathy) (Skill: `andrej-karpathy-skills:karpathy-guidelines`) when writing, reviewing, or refactoring code in this repo. Core posture: prefer surgical changes, avoid overcomplication, surface assumptions explicitly, and define verifiable success criteria before declaring done.

### Issue tracker

GitHub Issues on `naratornb/ai-itinerary-planner`, via the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Multi-context — `CONTEXT-MAP.md` at root points to per-app `CONTEXT.md` files. See [docs/agents/domain.md](docs/agents/domain.md).
