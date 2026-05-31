# AGENTS.md

Guidance for AI agents working in this repo. This file is read by Claude Code, Cursor, Codex, and other agent CLIs that follow the [agents.md](https://agents.md) convention.

## Repo shape

Monorepo:
- `apps/api/` — Python FastAPI backend (see [apps/api/CONTEXT.md](apps/api/CONTEXT.md))
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

### Commit messages (Conventional Commits)

`<type>(<scope>): <imperative summary>`

- **Types**: `feat`, `fix`, `doc`, `refactor`, `test`, `chore`, `style`, `perf`, `build`, `ci`
- **Scope** (optional but encouraged): `api`, `web`, `infra`, `db`, or a more specific module
- **Summary**: imperative mood, no trailing period, ≤72 chars

Examples (matches existing repo style):
- `doc: add relevant doc for reference`
- `feat(api): add /itineraries POST endpoint`
- `fix(web): handle 401 on dashboard route`
- `chore(infra): bump postgres to 17.2`

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
