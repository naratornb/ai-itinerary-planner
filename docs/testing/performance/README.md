# Performance Testing — Decision Brief

**Status:** Proposed (awaiting review) · **Date:** 2026-09-23 · **Owner:** Testing lead

This directory holds the performance-testing workstream for the itinerary planner:

| File | What it is |
|------|------------|
| [README.md](README.md) | This decision brief — what we test, what we deliberately skip, and why |
| [test-plan.md](test-plan.md) | The minimal test plan: scenarios, environments, thresholds, runbook |
| [ai-token-strategy.md](ai-token-strategy.md) | How to performance-test the AI features without burning API tokens |
| [sample-report.html](sample-report.html) | Sample of the shareable HTML report (illustrative data) — real ones are generated per run by `apps/test/perf/report.py` into `reports/` |

## Goal

Establish the **minimum** performance testing that tells us whether the software
is fast enough and stays that way — not a full performance-engineering program.
Every scenario in the plan must answer a question we would actually act on.

## Context (what the codebase looks like today)

- Two apps: Next.js 16 web (`apps/web`) and Python FastAPI (`apps/api`), both on
  Vercel (hobby plan), data in Supabase Cloud.
- All AI calls go to Gemini (`gemini-3.6-flash`) via raw REST, centralized in
  `apps/api/app/ai/llm_provider.py` for the API app, plus two direct-REST routes
  in `apps/web/app/api/ai/`. Nothing streams; every call is a single blocking
  `generateContent`.
- The hot path is itinerary generation (`apps/api/app/ai/engine.py`):
  full-table Supabase fetch → pandas filtering → large inventory prompt
  (`LLM_MAX_TOKENS = 16000`) → up to 4 LLM attempts with backoff sleeps →
  validation → deterministic budget.
- There is **no existing perf or load testing**, no rate limiting, and (apart
  from a 24h in-memory war-zone cache) no caching.
- Useful levers already in the repo: pytest mocks stub Gemini at the
  `_call_gemini` boundary, and `engine.py` carries `perf_counter` timing
  instrumentation that separates LLM time from our own code's time.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Load tests never hit the real LLM.** All load scenarios run with the LLM stubbed at the provider boundary. | Real-LLM load testing burns tokens, triggers 429s, and — because of the `sleep(20*attempt)` retry policy — turns a load test into a self-inflicted outage. It also measures Google's latency, which we don't control. See [ai-token-strategy.md](ai-token-strategy.md). |
| D2 | **Real-LLM measurement is a small, capped, manual baseline** — sequential calls, hard budget per run, run per release, not in CI. | LLM latency and token usage do need a number, but a handful of samples gives us p50/p95 well enough to spot regressions. Repeating it thousands of times buys nothing. |
| D3 | **Load runs target a local production build, not Vercel.** | Hobby plan: load-testing Vercel-hosted endpoints risks quota exhaustion and violates fair-use expectations. Local `uvicorn` + `next start` measures the code we own. Serverless cold start is checked separately as a one-off observation, not a load scenario. |
| D4 | **Tooling is Grafana k6 for load scenarios; the real-LLM baseline stays a tiny plain-Python script.** | k6 is free/open-source (AGPL), a single static binary (nothing added to either app's dependency tree), and the modern corporate-standard load tool — skills and scripts transfer, and CI/Grafana integrations exist if D5 is ever revisited. Scenarios are JavaScript, which the team already writes daily. Built-in thresholds map directly onto the plan's pass criteria. The PERF-05 baseline is deliberately *not* a k6 scenario so the real-LLM path is sequential-with-a-hard-cap by construction. (JMeter rejected as legacy-heavyweight; Locust rejected on corporate mindshare after initially being considered.) |
| D5 | **Perf tests are not in CI.** They run from a manual runbook, per release or before perf-sensitive merges. | CI runs on GitHub-hosted runners with noisy neighbours; thresholds there flake, and flaky gates get deleted. A manual, comparable-environment run is worth more than an automated, incomparable one. |
| D6 | **Frontend perf is a single manual Lighthouse pass, not automated Web Vitals.** | The product's perceived slowness lives in the AI endpoints (up to 120 s), not in page rendering. One Lighthouse run catches gross regressions; automation here is not yet earning its keep. |
| D7 | **First run establishes baselines; thresholds in the plan are provisional until then.** | We have no historical numbers. Inventing hard SLAs before measuring produces arbitrary red/green. |

## Deliberately out of scope (YAGNI)

- Soak/endurance tests, spike tests, distributed load generation.
- Automated Web Vitals / RUM tooling.
- Database-level benchmarking (Supabase is managed; we measure it indirectly
  through the API paths that use it).
- Perf-testing the `/ai/suggest` endpoint — it is a stub with no real LLM yet.
- CI-gated performance budgets (revisit if/when D5 stops holding).

## Findings surfaced while planning (not perf work, but worth tickets)

1. **Retry policy under load:** `engine.py` retries up to 4× with
   `time.sleep(20*attempt)` on 429. Under concurrent load this holds request
   threads for minutes and amplifies the very rate-limiting it's reacting to.
2. **Model config drift:** `gemini-3.6-flash` is the default in three places,
   but `apps/web/app/api/ai/validate/route.ts` defaults to `gemini-2.5-flash`
   via a differently-named env var (`MODEL_NAME` vs `GEMINI_MODEL`).
3. **No rate limiting anywhere** (one documented TODO on the public auth
   endpoint). Any real-world load result must be read knowing the front door
   is unprotected.
4. **Prompt logging:** the validate route logs the full prompt to console on
   every call — noise and cost in Vercel logs under load.
