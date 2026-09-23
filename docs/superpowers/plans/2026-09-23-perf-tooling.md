# Performance-Test Tooling — Implementation Plan

**Spec:** `docs/testing/performance/test-plan.md` (work items W1–W4) and
`docs/testing/performance/ai-token-strategy.md`. Those documents are the
binding authority; this plan implements their work items.

## Global Constraints

- **Forbidden terms (hard CI gate):** never write any term from the
  "Forbidden terminology" section of AGENTS.md in any file, comment, or
  fixture — AGENTS.md is the one place the literal list may live.
- **No new dependencies.** Python work uses stdlib only (`urllib`, `json`,
  `statistics`, `os`, `time`, `argparse`). k6 is an external binary the user
  installs (`brew install k6`); nothing k6-related enters any package.json or
  requirements file.
- **Default behavior unchanged:** with none of the new env vars set, the
  application must behave byte-for-byte as before. The stub must be
  unreachable in production paths unless explicitly enabled.
- **Env contract:** every new env var is added to `.env.example` in the same
  task that introduces it, commented as perf-testing-only.
- **Ponytail posture:** minimal code; deliberate shortcuts carry a
  `ponytail:` comment naming the ceiling and upgrade path.
- **Tests:** each task ships at least one runnable check that fails if its
  logic breaks. `apps/api` work must keep `pytest` green
  (`cd apps/api && .venv/bin/python -m pytest`).
- **No AI attribution** in commits or anywhere else. Commit format
  `<type>: <imperative summary>`, no scope parens, ≤72 chars.
- **Do not run git commit/push.** Implementers leave all changes uncommitted
  in the working tree; the controller commits per task.
- k6 is NOT installed on this machine: k6 scripts are verified with
  `node --check <file>` (syntax only) plus careful reading — do not attempt
  `k6 run`.

## Task 1: Env-gated LLM stub in the API provider (W1)

**Files:** `apps/api/app/ai/llm_provider.py` (edit),
`apps/api/tests/test_llm_stub.py` (new), `.env.example` (edit).

Add an early exit at the top of `call_llm()` in
`apps/api/app/ai/llm_provider.py`:

- If env `LLM_STUB` == `"1"`:
  - If `LLM_STUB_DELAY_MS` is set and > 0, `time.sleep(ms / 1000)` first —
    but never sleep past the call's `deadline` if one was passed (respect the
    existing deadline semantics of `call_llm`; read the function first).
  - If `LLM_STUB_FIXTURE` is set, return the text content of that file
    (read once per call is fine — ponytail).
  - Otherwise return a minimal canned string: `"{}"`. Callers whose JSON
    validation rejects it will exercise their existing fallback paths
    (e.g. the engine's deterministic fallback itinerary) — that is an
    accepted, documented load path until real fixtures are recorded.
- The stub returns whatever type the real path returns — read the function
  and match its return contract exactly (text vs tuple vs dict).
- Mark the block with a `ponytail:` comment: fixture is re-read per call and
  a single global stub serves all callers; per-caller fixtures via
  `LLM_STUB_FIXTURE` pointing at different files per process if ever needed.
- ~20 lines total. Do not restructure anything else in the file.

**Tests** (`apps/api/tests/test_llm_stub.py`, follow the style of the
existing tests in `apps/api/tests/`):
1. With `LLM_STUB=1` and a fixture file (tmp_path), `call_llm` returns the
   fixture content and makes no network call (no mocking of urllib needed —
   if it tried the network with a bogus key it would raise; a returned
   fixture proves the early exit).
2. With `LLM_STUB=1` and no fixture var, returns the canned minimal value.
3. With `LLM_STUB` unset, the stub path is not taken (e.g. monkeypatch the
   internal Gemini call as existing tests do, and assert it IS called).
4. `LLM_STUB_DELAY_MS=50` measurably delays the stubbed call (assert
   elapsed >= 0.05s, keep the delay tiny).

Use `monkeypatch.setenv`/`delenv`. Run the full `apps/api` pytest suite once
before finishing.

**`.env.example`:** add `LLM_STUB`, `LLM_STUB_DELAY_MS`, `LLM_STUB_FIXTURE`
under a comment `# Performance testing only (see docs/testing/performance/)`.

## Task 2: k6 load scenarios (W3)

**Files (all new):** `apps/test/perf/k6/helpers.js`,
`apps/test/perf/k6/perf-01-recommend.js`, `apps/test/perf/k6/perf-02-copilot.js`,
`apps/test/perf/k6/perf-03-marketplace.js`, `apps/test/perf/k6/perf-04-validate.js`.

These implement scenarios PERF-01…04 from
`docs/testing/performance/test-plan.md` §4 (read it). Before writing them,
read the real routes to get paths, methods, auth, and payload shapes right:

- `apps/api/app/ai/router.py` (POST `/ai/recommend`)
- `apps/api/app/copilot/router.py` (POST `/ai/copilot/{package_id}/turns`)
- `apps/api/app/marketplace/router.py` (list/search endpoints)
- `apps/web/app/api/ai/validate/route.ts` (POST `/api/ai/validate`)
- Realistic payloads: adapt from the Bruno smoke collection under
  `apps/test/fc-itinerary-planner-test-collection/` (folder `06-ai` and
  neighbours). Copy payload SHAPES; invent innocuous values.

**helpers.js** exports: `API_BASE` (env `API_BASE`, default
`http://localhost:8000`), `WEB_BASE` (env `WEB_BASE`, default
`http://localhost:3000`), a `headers()` helper that adds
`Authorization: Bearer ${__ENV.TOKEN}` when `TOKEN` is set, and shared
default `options` fragments. Keep it small.

**Per scenario** (k6 idioms: `export const options`, default function,
`constant-vus` executor):

| File | Target | VUs | Duration | Thresholds |
|---|---|---|---|---|
| perf-01 | POST `${API_BASE}/ai/recommend` | 10 | 2m | `http_req_duration: ['p(95)<8000']`, `http_req_failed: ['rate<0.01']` |
| perf-02 | POST `${API_BASE}/ai/copilot/${__ENV.PACKAGE_ID}/turns` | 5 | 2m | `p(95)<5000`, `rate<0.01` |
| perf-03 | marketplace list + search, mixed | 20 | 2m | `p(95)<1500`, `rate<0.01` |
| perf-04 | POST `${WEB_BASE}/api/ai/validate` | 10 | 1m | `p(95)<2000`, `rate<0.01` |

- perf-02 requires `PACKAGE_ID` env; fail fast with a clear message if
  unset (creating a package in `setup()` is out of scope — ponytail comment
  noting that upgrade path).
- Each request wrapped in a k6 `check()` on status 200.
- Each file's header comment shows the run command including the summary
  export the report generator expects, e.g.
  `k6 run --summary-export=out/perf-01.json apps/test/perf/k6/perf-01-recommend.js`.
- Timeouts: perf-01 requests may take tens of seconds with a stub delay —
  set per-request `timeout` generously (e.g. `'120s'` for perf-01).

**Verification:** `node --check` passes on every file (k6 modules aren't
resolvable under node — `node --check` only parses syntax, which is exactly
what we can verify here). State in your report that runtime verification
requires k6 + a running stack.

## Task 3: Real-LLM baseline script (W4)

**Files:** `apps/test/perf/llm_baseline.py` (new),
`apps/test/perf/test_llm_baseline.py` (new),
`apps/test/perf/report.py` (one small edit).

Plain-Python (stdlib only) implementation of PERF-05 from
`docs/testing/performance/test-plan.md` §4 and the budget rules in
`docs/testing/performance/ai-token-strategy.md` §4. Read both sections
first, plus the same route files as Task 2 for payload shapes.

Behavior:

- Sequential only. Hard caps as module constants: `CALLS_PER_ENDPOINT = 10`,
  `MAX_TOTAL_CALLS = 40`. Counted across all endpoints; the loop must stop
  at the cap even if misconfigured.
- Endpoints (each optional via CLI flags, default all): itinerary
  generation (POST `${API_BASE}/ai/recommend`), copilot turn (needs
  `--package-id`), content generation (POST `${WEB_BASE}/api/ai/generate-content`).
- Per call: record wall-clock ms and HTTP status. On the FIRST 429 (or the
  API's `RATE_LIMITED` error body), abort the entire run and say why —
  per the strategy doc's abort rule.
- Token counts: capture from the response body if a `usageMetadata` (or
  equivalent usage field) is present; otherwise record 0. Our API routes do
  not currently surface Gemini's usage metadata, so 0 is the expected value
  for now — put a `ponytail:` comment naming that ceiling (upgrade path:
  API passes through `usageMetadata`). Do NOT modify API routes.
- Optional `--record-fixtures DIR`: save each endpoint's first raw response
  body to `DIR/<endpoint>.json` (this is work item W2's capture mechanism).
- Output: write `llm_baseline.json` (path via `--out`, default alongside
  the summary exports in `out/`) matching exactly the shape `report.py`
  reads: `{"total_calls": int, "model": str, "endpoints": [{"name", "calls",
  "p50_ms", "p95_ms", "tokens_in_avg", "tokens_out_avg", "retries_429"}]}`.
  Model name from env `GEMINI_MODEL` (default `gemini-3.6-flash`).
  p50/p95 via `statistics.quantiles` or a simple sorted-index pick — either
  is fine at n=10.
- `TOKEN` env → `Authorization: Bearer` header, same convention as Task 2.

**report.py edit (one guard):** in the baseline section, skip the token
chart (`token_chart(...)` figure only, keep the table) when every endpoint's
`tokens_in_avg` and `tokens_out_avg` are 0 — otherwise the chart renders all
zero-width bars. Change only what this requires.

**Tests** (`apps/test/perf/test_llm_baseline.py`, runnable as
`python -m pytest apps/test/perf/test_llm_baseline.py` from repo root using
the api venv, OR plain `python apps/test/perf/test_llm_baseline.py` with
asserts — match whichever is simpler given the script has no deps):
1. Stats/output shape: feed recorded fake samples into the aggregation
   function and assert the JSON shape matches the contract above.
2. Cap enforcement: with the HTTP-call function monkeypatched/injected,
   assert no more than `MAX_TOTAL_CALLS` calls occur.
3. 429 abort: injected 429 on call 3 stops the run and marks it aborted.
Structure the script so the HTTP call is one small injectable function —
that is what makes these tests possible without a server.

Also regenerate the sample report
(`python3 apps/test/perf/report.py apps/test/perf/sample-run docs/testing/performance/sample-report.html`)
to confirm the report.py edit leaves the sample (which has nonzero tokens)
rendering the token chart, and verify the guard by a quick temporary
zero-token input if convenient.
