# Testing AI-Feature Performance Without Burning Tokens

**Status:** Proposed (awaiting review) · **Date:** 2026-09-23
**Companion to:** [test-plan.md](test-plan.md)

## 1. The core insight

An AI endpoint's latency splits into two parts with completely different
testing economics:

```
end-to-end latency = our code (fetch, filter, prompt build, parse, validate)
                   + the provider's code (Gemini generateContent)
```

We can only fix **our** part. The provider's part we can observe but not
improve — so measuring it thousands of times under load is pure token burn
with zero actionable output. Everything below follows from that split:

- **Our part** → test as hard and as often as we like, with the LLM stubbed.
  Cost: zero tokens.
- **Their part** → sample it. A small sequential baseline (p50/p95 from ~10
  calls) is as actionable as ten thousand.

The repo already half-supports this: pytest mocks Gemini at the
`_call_gemini` boundary in `apps/api/app/ai/llm_provider.py`, and
`engine.py` / `copilot/service.py` log timing that separates LLM time from
own-code time. The strategy just extends the same seam from unit tests to
perf runs.

## 2. Technique 1 — Stub at the provider boundary (zero tokens)

Add an env-gated stub inside `call_llm()` (work item W1 in the test plan):

- `LLM_STUB=1` → return a recorded fixture instead of calling Gemini.
- `LLM_STUB_DELAY_MS=<n>` → sleep before returning, to simulate provider
  latency and exercise timeout/deadline/threadpool behaviour realistically.

Why at `call_llm()` and not per-endpoint: it's the single choke point every
API-app AI feature already routes through, so one ~20-line change covers the
itinerary engine and the copilot at once, and the stub exercises everything
downstream of the real call — JSON parsing, fence-stripping, validation,
fallback-itinerary logic — exactly as production runs it.

This makes **all load testing free**: PERF-01 and PERF-02 in the test plan hit
the full request path at any concurrency for 0 tokens.

## 3. Technique 2 — Record/replay fixtures (spend once, reuse forever)

Fixtures must be *real* responses, not hand-written ones — hand-written
fixtures drift from what Gemini actually returns (markdown fences, trailing
commas, field ordering) and silently stop exercising `parse_json_response()`.

- During the first real-LLM baseline run (PERF-05), save the raw response
  bodies to `apps/test/perf/fixtures/` (work item W2).
- Re-record only when the prompt contract or model changes — not on a
  schedule. The diff between old and new fixtures is itself useful review
  material (did the model's output shape change?).

Total recording cost: a handful of calls, once per prompt-contract change.

## 4. Technique 3 — A capped, sequential real-call budget

Some questions genuinely need real calls: actual latency percentiles, token
counts, retry/429 behaviour. Rules that keep this affordable:

| Rule | Value | Why |
|------|-------|-----|
| Calls per baseline run | **≤ 40** (10 per endpoint × up to 4 endpoints) | Enough for stable p50 and a usable p95; ~1 extra sample changes nothing |
| Concurrency | **Sequential only** | Concurrent real calls invite 429s, and the engine's `sleep(20*attempt)` backoff turns those into multi-minute stalls |
| Frequency | Once per release, or after a prompt/model change | Latency baselines don't decay daily |
| In CI? | **Never** | A CI loop is how token budgets die |
| Abort condition | First 429 → stop the run | Quota is already stressed; more calls make it worse |
| Key | Dedicated **test** Gemini API key, separate from prod | Isolates test spend/quota from real users, and makes test usage visible as its own line in the provider console |

Worst-case cost envelope per run, using the largest prompt (itinerary
engine: full-inventory prompt + `LLM_MAX_TOKENS = 16000` output): roughly
10 calls × (~10k in + ≤16k out) ≈ 260k tokens, and the other endpoints are
far smaller — comfortably inside a flash-tier model's budget, and a
fixed, predictable amount rather than load-test-shaped.

## 5. Technique 4 — Read token counts from responses you already paid for

Gemini returns `usageMetadata` (prompt/candidate token counts) on every
response. PERF-05 records these from its 40 calls — giving per-endpoint
token baselines **for free**, since the calls were being made anyway. A
prompt-size regression (e.g. the inventory filter loosening from 8 activities
to 80) then shows up as a number in `baselines.md`, not as a surprise bill.

Cheaper still: prompt size can be regression-checked with *zero* calls — a
unit test that builds the itinerary prompt from seed data and asserts
`len(prompt)` stays under a ceiling catches the same class of bug before any
API is involved. Worth adding if prompt size ever regresses once.

## 6. Technique 5 — Small data for real runs

Real-call latency and correctness don't need the full inventory. Where a
scenario allows it, point real-LLM runs at requests whose filters select the
smallest realistic candidate set (the engine already caps at 5 flights /
4 hotels / 8 activities — choose destinations/dates that come in at or under
those caps rather than testing the pathological maximum every time). Save the
max-inventory case for one deliberate sample per run, not all ten.

## 7. What we deliberately don't do

- **No load testing against real Gemini, ever** (decision D1). It measures
  Google, costs tokens, and — via the retry backoff — DoSes ourselves.
- **No LLM-quality evaluation in perf runs.** Output *quality* testing (does
  the itinerary make sense?) is a different workstream with different tools;
  mixing it into perf runs multiplies call counts. The perf suite only checks
  that responses parse and validate.
- **No mock "AI service" microservice.** The env-gated stub inside
  `call_llm()` is one function; a fake server is infrastructure. YAGNI.

## 8. Summary: where each question gets answered

| Question | Technique | Token cost |
|----------|-----------|-----------|
| Is *our* code fast under load? | Stub (§2) + load scenarios PERF-01…04 | 0 |
| Does timeout/deadline handling work? | Stub with `LLM_STUB_DELAY_MS` (§2) | 0 |
| Does response parsing still match reality? | Recorded fixtures (§3) | ~5 calls per prompt change |
| How slow is the LLM, really? | Capped sequential baseline (§4) | ≤ 40 calls per release |
| Are prompts growing? | `usageMetadata` from those same calls (§5), optional zero-call length assert | 0 extra |
