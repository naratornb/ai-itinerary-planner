# Minimal Performance Test Plan

**Status:** Proposed (awaiting review) · **Date:** 2026-09-23
**Prerequisite reading:** [README.md](README.md) (decisions D1–D7), [ai-token-strategy.md](ai-token-strategy.md)

## 1. Objectives

Answer four questions, cheaply:

1. How long does an itinerary request take **excluding** the LLM call — i.e. the
   code we own (Supabase fetch, pandas filtering, prompt build, validation)?
2. Do the AI-fronting endpoints degrade gracefully under modest concurrency
   (errors, timeouts, thread starvation)?
3. What are the current real-LLM latency and token-usage baselines, per
   endpoint, so regressions are visible release-to-release?
4. Are the non-AI read paths (marketplace list/search) responsive under load?

## 2. Scope

**In scope (system under test):**

| ID | Endpoint | App | Notes |
|----|----------|-----|-------|
| S1 | `POST /ai/recommend` | `apps/api` (`app/ai/router.py`) | Hot path via `generate_itinerary()` in `engine.py` |
| S2 | `POST /ai/copilot/{package_id}/turns` | `apps/api` (`app/copilot/router.py`) | 25 s deadline budget threaded through to the LLM call |
| S3 | Marketplace list/search | `apps/api` (`app/marketplace/router.py`) | Pure DB path, no AI |
| S4 | `POST /api/ai/validate` | `apps/web` | Deterministic checks + Gemini contextual checks |
| S5 | `POST /api/ai/generate-content` | `apps/web` | Marketing copy generation |

**Out of scope:** see README "Deliberately out of scope".

## 3. Test environment

- **Load runs (PERF-01…04):** local machine.
  - API: `uvicorn` serving `apps/api` (same entry as `api/index.py`).
  - Web: `next build && next start` in `apps/web` (production build — `next dev`
    numbers are meaningless).
  - Data: real Supabase Cloud project with the standard seed data. Load
    scenarios are read-only or write to throwaway packages; never delete seeded
    users (standing rule).
  - LLM: **stubbed** (see [ai-token-strategy.md](ai-token-strategy.md) §2).
- **Real-LLM baseline (PERF-05):** same local setup, LLM stub disabled,
  dedicated test API key, hard call cap.
- **Cold-start observation (PERF-06):** Vercel preview deployment, a handful of
  manual requests — not a load run.

Record with every run: git SHA, machine, `GEMINI_MODEL`, seed-data row counts
(flights/hotels/activities), stub delay setting.

## 4. Scenarios

Thresholds marked *(provisional)* per decision D7 — the first run replaces them
with baseline-derived values (suggested rule of thumb: threshold = baseline p95
× 1.5, reviewed by a human).

### PERF-01 — Itinerary generation, LLM stubbed (the code we own)

- **Endpoint:** S1, direct to FastAPI.
- **Load:** 10 concurrent workers, 2 minutes, realistic wizard-shaped payloads
  (reuse request bodies from the Bruno `06-ai` folder).
- **Stub delay:** 0 ms (isolates our code) and a second pass at 5 000 ms
  (checks threadpool behaviour while requests park in the sync `def` handler).
- **Measure:** p50/p95 latency, error rate, and the engine's own `[timing]`
  log lines (fetch vs pandas vs prompt-build vs validation split).
- **Pass (provisional):** p95 ≤ 10 s ex-LLM at 0 ms stub delay; error rate < 1 %;
  no 5xx from thread exhaustion at 5 000 ms stub delay.

### PERF-02 — Copilot turn, LLM stubbed

- **Endpoint:** S2. Setup: create one throwaway package, then loop turns on it.
- **Load:** 5 concurrent workers, 2 minutes.
- **Measure:** p50/p95, error rate, `retrieval_ms` from the service logs, and
  how much of the 25 s deadline budget the non-LLM work consumes.
- **Pass (provisional):** p95 ex-LLM ≤ 5 s; zero deadline-exceeded errors at
  0 ms stub delay.

### PERF-03 — Marketplace list/search (no AI)

- **Endpoint:** S3.
- **Load:** 20 concurrent workers, 2 minutes, mixed list + search queries.
- **Pass (provisional):** p95 ≤ 2 s; error rate < 1 %.

### PERF-04 — Validate route, deterministic path

- **Endpoint:** S4, run with `GEMINI_API_KEY` set to a deliberately invalid
  value: the route 500s when the key is *absent*, but a rejected Gemini
  response hits its graceful-skip path, dropping the AI checks so we measure
  the deterministic feasibility checks (plus one rejected outbound round trip
  per request — not purely local work).
- **Load:** 10 concurrent workers, 1 minute.
- **Pass (provisional):** p95 ≤ 2 s; error rate < 1 %.

### PERF-05 — Real-LLM latency & token baseline (manual, capped)

- **Endpoints:** S1, S2, S5 with real Gemini. **Sequential, never concurrent.**
- **Sample size:** 10 calls per endpoint, hard cap **40 calls per run**, at most
  one run per release. Full rules in [ai-token-strategy.md](ai-token-strategy.md) §4.
- **Measure:** end-to-end p50/p95, LLM-only time (from `[timing]` logs),
  prompt/output token counts from the Gemini `usageMetadata` in the response,
  retry/429 count.
- **Pass:** no threshold — this run *produces* the baseline table (§6) and
  fails only on errors or a >2× regression against the previous release's
  numbers.

### PERF-06 — Serverless cold start (observation, not load)

- After ≥15 minutes idle, hit the Vercel **preview** deployment of each app
  once; record first-hit vs warm-hit latency. Repeat 3×. Purely informational
  (module-level caches like `warZoneCache` are per-instance and effectively
  cold in serverless — this run shows what users actually feel).

## 5. Tooling & prerequisite work

Per decision D4, k6 scenarios plus one small baseline script; per D1, one
small stub. Estimated total: a day of work. k6 installs as a single binary
(`brew install k6`) — it is not added to either app's dependency tree.

| Item | What | Where |
|------|------|-------|
| W1 | Env-gated LLM stub in `call_llm()`: `LLM_STUB=1` returns a fixture response, `LLM_STUB_DELAY_MS` adds artificial latency. ~20 lines, marked with a `ponytail:` comment. | `apps/api/app/ai/llm_provider.py` |
| W2 | Captured fixtures: one real response per endpoint, recorded once during the first PERF-05 run. | `apps/test/perf/fixtures/` |
| W3 | k6 scenario scripts for PERF-01…04: constant concurrency via the `constant-vus` executor, pass criteria expressed as k6 `thresholds` (e.g. `http_req_duration: ['p(95)<8000']`, `http_req_failed: ['rate<0.01']`), scenario payloads adapted from the Bruno collection. One `.js` file per scenario plus a shared helpers module. (`--summary-export` is deprecated in k6 v1.x but still emits the shape `report.py` reads — expect a warning and re-confirm the JSON on first run.) | `apps/test/perf/k6/` |
| W4 | Real-LLM baseline script for PERF-05: plain Python, sequential, hard 40-call cap, records latency + `usageMetadata` token counts. Kept out of k6 deliberately so the real-LLM path cannot be run at concurrency. | `apps/test/perf/llm_baseline.py` |
| W5 | Baseline results table (checked in, updated per run). | `docs/testing/performance/baselines.md` (created by first run) |
| W6 | **Done.** HTML report generator: renders a run directory (k6 summary exports + baseline JSON + `run_meta.json`) into a single self-contained `perf-report.html` — executive summary tiles up top for leadership, per-scenario charts and tables below for the technical lead. Stdlib only, no dependencies. Sample output: [sample-report.html](sample-report.html) (illustrative data, generated from `apps/test/perf/sample-run/`). | `apps/test/perf/report.py` |

The web routes (S4, S5) call Gemini directly rather than through
`llm_provider.py`; for S4 the no-key graceful-skip already acts as a stub, and
S5 only appears in the capped PERF-05 run — so no web-side stub is needed. If
S5 ever needs load testing, add the same env-gated stub there first.

## 6. Reporting

Each run appends one row per scenario to `baselines.md`:

```
| date | sha | scenario | p50 | p95 | err% | tokens in/out (PERF-05 only) | notes |
```

Regression = p95 worse than 1.5× the previous accepted baseline → open an
issue before merging/releasing the change under test.

## 7. Runbook (manual, per release)

0. Tooling self-check: `python3 apps/test/perf/test_llm_baseline.py` (these
   tests run nowhere else — perf tooling stays out of CI per D5).
1. `git rev-parse HEAD` → note SHA, then `mkdir -p out` and write
   `out/run_meta.json` (the report generator's header reads it):
   `{"date": "...", "sha": "...", "machine": "...", "model": "$GEMINI_MODEL",
   "stub_delay_ms": 0, "seed_counts": "..."}` — see
   `apps/test/perf/sample-run/run_meta.json` for a filled-in example.
2. Start the stack: API (`uvicorn`) with `LLM_STUB=1` (and, on the fixture
   pass, `LLM_STUB_FIXTURE=apps/test/perf/fixtures/recommend.json`); web
   (`next build && next start`) with `GEMINI_API_KEY` set to a **deliberately
   invalid value** — `LLM_STUB` only affects the API app, and PERF-04 calls
   Gemini from the web app on every request: a valid key here means ~600 real
   calls per run, exactly what decision D1 forbids.
3. Run PERF-01 → PERF-04:
   `k6 run --summary-export=out/perf-01.json apps/test/perf/k6/perf-01-recommend.js`
   (and likewise per scenario; PERF-02 additionally needs
   `-e PACKAGE_ID=<throwaway-package-uuid> -e TOKEN=<jwt>`). k6's thresholds
   report pass/fail per the plan's criteria; the exported summaries feed
   `baselines.md`. Note these scripts are syntax-verified only until their
   first real run — expect to debug them the first time.
4. Restart the API with the stub off and the **test** Gemini key; run PERF-05:
   `python3 apps/test/perf/llm_baseline.py --package-id <same-uuid>
   --record-fixtures apps/test/perf/fixtures` (sequential, 40-call cap
   enforced by the script; `TOKEN` env required for the copilot endpoint).
   `--record-fixtures` captures work item W2's response fixtures.
5. Once fixtures exist, re-run PERF-01/02 with `LLM_STUB_FIXTURE` pointing at
   them so the load path parses real responses instead of exercising the
   fallback (without a fixture the stub returns `{}` — see §8).
6. PERF-06 against the current preview deployment.
7. Update `baselines.md`; file issues for any regression or new error class.
8. Generate the shareable report:
   `python3 apps/test/perf/report.py out/ docs/testing/performance/reports/<date>-perf-report.html`
   — a self-contained HTML file (summary tiles + charts + tables) suitable for
   both the technical lead and leadership; safe to attach or email as-is.

## 8. Risks & caveats

- **Local ≠ Vercel:** load numbers measure our code, not production
  infrastructure. PERF-06 plus real-user reports cover the gap; if that stops
  being enough, revisit decision D3 rather than load-testing the hobby plan.
- **Shared Supabase:** load runs hit the real dev database; run outside
  stakeholder demo hours and keep scenarios read-mostly.
- **Retry amplification:** if PERF-05 ever hits a 429, stop the run — the
  20 s/40 s/60 s backoff sleeps mean continuing just queues pain (README
  finding #1 tracks the underlying fix).
- **Stubbed-run blind spot (PERF-01/02):** without `LLM_STUB_FIXTURE`, the
  stub returns `{}`, which fails JSON validation and measures the engine's
  deterministic-fallback path, not the parse-and-validate path — optimistic
  p95s. And the copilot downgrades an AI failure to a 201 with an
  `AI_UNAVAILABLE` warning, so a degraded run passes the same status check as
  a healthy one. Run the fixture pass (runbook step 5) before trusting
  PERF-01/02 numbers.
- **PERF-04 blind spot:** the validate route's outer catch-all returns 200
  with a "limited checks" body, so a swallowed exception is statistically
  indistinguishable from a healthy run in the k6 summary. Spot-check one
  response body before trusting a PERF-04 run. More generally, k6 `check()`
  failures appear only in k6's console output — the generated HTML report
  reads latency and `http_req_failed` only.
- **PERF-02/PERF-05 side effects:** copilot scenarios append real turn rows
  to the target package (hundreds over a 2-minute load run). Use a throwaway
  package and discard it afterwards.
- **Thresholds are provisional** until the first baseline run (D7).
