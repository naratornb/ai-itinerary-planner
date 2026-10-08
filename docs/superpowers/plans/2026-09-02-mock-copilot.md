# Mock Co-Pilot Interaction Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clearly labelled frontend-only Mock Co-Pilot that adds typed mock activity suggestions to a normalized active itinerary day.

**Architecture:** Pure Builder state helpers normalize day/item ownership. A versioned Co-Pilot client interface isolates deterministic mock responses from a reusable conversation hook and sidebar UI. The editor is the only integration boundary that mutates itinerary state.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Node test runner, existing CSS tokens

**Spec:** `docs/superpowers/specs/2026-09-02-mock-copilot-design.md`

## Global Constraints

- Frontend-only mock interaction prototype; never imply functional AI or verified inventory.
- No API calls and no new dependency.
- Reuse the existing design tokens and editor patterns.
- Tests precede implementation changes.

---

### Task 1: Day-aware Builder state

**Files:**
- Create: `apps/web/lib/itinerary-builder.ts`
- Test: `apps/web/lib/itinerary-builder.test.ts`
- Modify: `apps/web/components/itinerary-editor.tsx`

- [ ] Write failing tests for active-day item access, append, edit, reorder, delete, and counts.
- [ ] Implement the minimal immutable helpers and types.
- [ ] Replace the editor's global items array with normalized days while preserving current behavior.
- [ ] Run focused tests and typecheck.

### Task 2: Versioned contract and mock provider

**Files:**
- Create: `apps/web/lib/copilot.ts`
- Create: `apps/web/lib/mock-copilot-client.ts`
- Test: `apps/web/lib/mock-copilot-client.test.ts`

- [ ] Write failing tests for normal, clarification, and catalogue-gap responses.
- [ ] Define `v1` request/response types and the client interface.
- [ ] Implement deterministic mock responses with an asynchronous boundary.
- [ ] Run focused tests and typecheck.

### Task 3: Conversation UI and editor integration

**Files:**
- Create: `apps/web/components/copilot/use-copilot.ts`
- Create: `apps/web/components/copilot/copilot-panel.tsx`
- Modify: `apps/web/components/itinerary-editor.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] Implement in-memory message and request state in the hook.
- [ ] Build accessible empty, loading, response, warning, next-action, error, and added states.
- [ ] Mount the panel at the top of the editor sidebar.
- [ ] Map activity suggestions to the active day and announce additions.

### Task 4: Verification

**Files:**
- Test: changed frontend targets

- [ ] Run `npm test` in `apps/web`.
- [ ] Run `npm run typecheck` in `apps/web`.
- [ ] Run `npm run lint` in `apps/web`.
- [ ] Run `npm run build` in `apps/web`.
- [ ] Run the design detector on changed UI targets.
- [ ] Inspect desktop and mobile layouts and correct material issues in one batch.
