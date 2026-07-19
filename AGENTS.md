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

### No automatic pushes

**AI agents must never push code without explicit human approval — no exceptions.** Committing locally is fine when asked; `git push` (any branch, any remote) requires the human to approve that specific push first. "Commit and push" style instructions still mean: commit, then ask before pushing.

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

### Coding posture (ponytail)

Every code change in this repo — by any collaborator or AI tool — follows the [ponytail](https://github.com/DietrichGebert/ponytail) lazy-coding posture:

- Take the laziest solution that works, in this order: reuse existing repo code → stdlib → native platform/DB feature → already-installed dependency → minimum new code. Never add a dependency for what a few lines can do.
- No speculative abstractions, no scaffolding "for later". Shortest working diff wins; deletion beats addition.
- Mark deliberate shortcuts with a `ponytail:` comment naming the ceiling and the upgrade path, e.g. `# ponytail: O(n²) scan, index it if packages exceed ~10k`.

Claude Code users get the plugin automatically: `.claude/settings.json` declares the marketplace and enables `ponytail@ponytail` — accept the install prompt on first open. Other AI tools (Cursor, Codex, …) must follow the rules above from this file.

### Frontend design (anydesign)

All frontend/UI implementation in `apps/web/` goes through the [`anydesign`](https://github.com/uxKero/anydesign) skill (`.claude/skills/anydesign/`):

- Given any visual reference (screenshot, URL, Figma, mockup), run the skill first to produce `design.md` + `design-tokens.json` — commit them under `apps/web/design/`.
- Implement UI **against those committed tokens** (colors, type, spacing, radii) — never hard-code ad-hoc values that bypass them.
- If `apps/web/design/` doesn't exist yet and there's no visual reference, proceed normally, but any new design decision worth keeping goes into `design.md` when it's first created.

### Issue tracker

GitHub Issues on `naratornb/ai-itinerary-planner`, via the `gh` CLI. External PRs are not a triage surface. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Database migrations

All schema changes must be recorded as Supabase migrations in `supabase/migrations/` — never applied ad-hoc via Studio or psql. See [docs/agents/database.md](docs/agents/database.md).

### Domain docs

Multi-context — `CONTEXT-MAP.md` at root points to per-app `CONTEXT.md` files. See [docs/agents/domain.md](docs/agents/domain.md).
