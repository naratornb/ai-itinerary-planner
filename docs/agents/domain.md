# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: multi-context

This repo's contexts are mapped from [CONTEXT-MAP.md](../../CONTEXT-MAP.md) at the root. Per-context glossaries live next to the code:

- [apps/api/CONTEXT.md](../../apps/api/CONTEXT.md) — Python Flask backend (FastAPI planned for Phase 2, see ADR-0001)
- [apps/web/CONTEXT.md](../../apps/web/CONTEXT.md) — Next.js + TypeScript frontend

System-wide ADRs live in `docs/adr/`. Context-scoped ADRs live in `apps/<context>/docs/adr/`.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- The relevant per-context `CONTEXT.md`.
- **`docs/adr/`** at the root for system-wide decisions, plus `apps/<context>/docs/adr/` for context-scoped ones.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT-MAP.md
├── docs/adr/                       ← system-wide decisions
└── apps/
    ├── api/
    │   ├── CONTEXT.md
    │   └── docs/adr/               ← API-specific decisions
    └── web/
        ├── CONTEXT.md
        └── docs/adr/               ← Web-specific decisions
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
