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
- `apps/api/` — Python backend: **Flask today, consolidating to async FastAPI** (per [ADR-0001](apps/api/docs/adr/0001-flask-now-fastapi-for-ai.md)). New endpoints go to FastAPI once the migration lands; don't grow the Flask surface. Glossary: [apps/api/CONTEXT.md](apps/api/CONTEXT.md)
- `apps/web/` — Next.js + **TypeScript** frontend (see [apps/web/CONTEXT.md](apps/web/CONTEXT.md)). No plain-JS additions.
- Supabase Cloud for auth/DB — no local Supabase stack; apps run natively (single root `.env`, see `.env.example`)
- Deploy target: **Vercel** (web + FastAPI serverless together). Keep the backend Vercel-compatible: app entrypoint importable as a serverless handler, no long-lived local state.

Default branch: `main`. Active dev branch: `develop`.

Branch protection: `main` requires a PR, 1 approving review, and a green `ci-ok` status check; `develop` requires green `ci-ok` (no force pushes on either). CI lives in `.github/workflows/ci.yml` (lint, typecheck, build, ruff, forbidden-terms scan) plus CodeQL and Dependabot.

## Workflow & quality rules

These apply to **every collaborator — human or AI agent — in any tool**.

### 1. Plan before code

- Non-trivial change (new endpoint, new page, schema change, refactor touching >2 files): state a short plan first — what changes, which files, how it's verified — and get it confirmed before editing. Claude Code: use plan mode; other tools: write the plan in the PR/issue first.
- Stress-test plans, don't rubber-stamp them: challenge scope, simpler alternatives, and edge cases before building (Claude Code: `/grilling` or `/scrutinize`).
- Trivial fixes (typo, one-liner, doc edit) skip planning — don't ceremonialize the small stuff.

### 2. Ponytail is the coding posture

[ponytail](https://github.com/DietrichGebert/ponytail) governs every code change (see Agent skills below): laziest solution that works, reuse before writing, stdlib/native before dependencies, deletion beats addition. A new dependency needs a one-line justification in the PR for why existing code/stdlib can't do it.

### 3. Tests & gates

- **Bug fixes are test-first**: write the failing test that reproduces the bug, then fix it. A fix without a test that would have caught it is not done.
- **Features ship with at least one runnable check** that fails if the logic breaks — one focused test file, not a suite for its own sake (YAGNI applies to tests too).
- Before every commit: `npm run lint` and `npm run build` pass in `apps/web`; the API test suite (when present) and an import smoke-check pass in `apps/api`.
- Never weaken a gate to get green: no skipped tests, no `--no-verify`, no loosening lint rules or types (`any`, `@ts-ignore`) without a comment explaining why and human sign-off.

### 4. PR & review discipline

- PRs are **small vertical slices**: one user-visible change end to end, not a layer at a time. If the diff description needs "and", consider splitting.
- **One change per branch.** A branch carries exactly one feature/fix/chore — the one its `<type>/<summary>` name states. Never stack several features or unrelated changes on a single branch; a second idea gets its own branch off `develop`. If a branch has drifted into multiple concerns, split it before opening the PR.
- Self-review before requesting human review (Claude Code: `/code-review` or `/scrutinize`). Fix what you find; note in the PR anything you saw and deliberately left.
- The PR body states: what changed, why, and **how it was verified** (commands run, what you observed). "Should work" is not verification.
- Migrations ship in the same PR as the code that depends on them.

### 5. Database & secrets guardrails

- Schema changes are **migrations only** (`supabase/migrations/`, append-only) — never ad-hoc via Studio, psql, or RPC. See [docs/agents/database.md](docs/agents/database.md).
- **Never run `supabase db push`** (or any command that applies migrations to a remote database). Use `supabase db push --dry-run` to preview only; the git pipeline applies migrations after merge.
- Every new table gets **RLS enabled and policies defined in the same migration** before it holds real data.
- The **service role key is server-only**: never in `apps/web`, never in a `NEXT_PUBLIC_*` var, never logged. The browser gets the anon key only.
- All config through the single root `.env` (`.env.example` is the contract — update it in the same PR as any new variable). Never commit `.env` or any secret value; secrets for deploys go in Vercel project settings, not files.

## Git workflow

### Branch from `develop`, never `main`

Every feature/fix/chore branch is created from the latest `develop` — **never from `main`**. `main` only moves by merging `develop` into it via PR. PRs from work branches target `develop`.

```sh
git fetch origin
git switch -c feat/<summary> origin/develop
```

### No automatic pushes

**AI agents must never push code without explicit human approval — no exceptions.** Committing locally is fine when asked; `git push` (any branch, any remote) requires the human to approve that specific push first. "Commit and push" style instructions still mean: commit, then ask before pushing.

### Branch naming

`<type>/<short-kebab-summary>`, e.g.:
- `feat/itinerary-day-builder`
- `fix/web-auth-redirect`
- `chore/bump-postgrest`

Use the same `type` vocabulary as commits (below). Rules:

- **Lowercase kebab-case only** — no spaces, underscores, or uppercase; `/` appears once, between type and summary.
- **Short and descriptive** (≤ ~40 chars): say what the branch delivers, not how.
- **Reference the issue when one exists**: `fix/123-auth-redirect`.
- Never work directly on `main` or `develop`.

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

**No AI attribution trailers.** Never add `Co-Authored-By`, "Generated with Claude Code", or any other AI-authorship line to commit messages, PR titles/bodies, or code comments.

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
