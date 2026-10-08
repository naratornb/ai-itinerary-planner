# Package co-pilot

The co-pilot adds contextual inventory suggestions to an existing saved package.
It runs inside the existing Vercel FastAPI app, uses the configured shared AI
provider, and stores each package conversation in Supabase. No frontend changes,
GPU, worker process, or separate hosting service are required.

## API

Use a Supabase access token in `Authorization: Bearer <access-token>`.
Only the package creator can create turns, read history or record feedback.

- `POST /ai/copilot/{package_id}/turns`, body `{"prompt":"Tokyo food under $100"}`: returns `201` with the persisted turn.
- `GET /ai/copilot/{package_id}/turns?page=1&per_page=20`: newest first, with pagination metadata.
- `PATCH /ai/copilot/{package_id}/turns/{turn_id}/items/{item_id}`, body `{"status":"dismissed"}` or `{"status":"accepted"}`: returns the updated item. `auto_apply` defaults to false; true returns `422` without changing status. Repeated/conflicting feedback returns `409`.

Prompts accept 1–1,000 trimmed characters, including short follow-ups like `Japan`
or `cheap options`. Each response contains `turn_id`, `package_id`, `prompt`,
`created_at`, `message`, `next_action`, `warnings`, `suggestions`, `generation_mode`,
and `response_time_ms`. Inventory details and prices come from Supabase records;
model output selects IDs and supplies brief wording. A catalog match is not a
promise of live availability or bookability.

`generation_mode` is `llm`, `inventory_fallback`, or `clarification`. Fallback is
an explicit inventory result, not a silently fabricated AI answer. A database
failure is an error rather than a claimed saved response. The RPC writes the turn
and all suggestion snapshots in one transaction.

## Conversation and retrieval

One package has one conversation. Read the current saved package and the latest
four completed turns; persist resolved destination/type/budget/category/style for
short follow-ups. Concurrent turns use the completed history visible when each
request reads it; no ordering between concurrent requests is promised. Clients
should submit conversational turns sequentially.

Hard filters run before BM25 ranking, with a maximum of five candidates. A country
query searches its catalog cities. Unknown explicit destinations, ambiguous
multi-destination/type requests and empty matches ask for clarification rather
than switching to unrelated inventory. Cheap means at most AUD100 per item;
hotel prices are per night, flight/activity prices per person. Explicit numeric
budgets use those same units and carry an `ITEM_BUDGET` warning. `any price`
removes the budget filter; `any category` clears an activity category.

Feedback is per item. Dismissed IDs are excluded from later turns in that package.
A generic `what next` uses the saved package: activities first, then missing hotels,
then missing flights. Accepting a suggestion does not fill those gaps.
Acceptance records a preference; it does not add items, update prices, reserve
inventory or change the package. History retains the inventory snapshot returned
at generation time. New turns read live inventory. Existing `/ai/suggest`,
`/ai/suggestions/...`, and `/ai/recommend` keep their current contracts.

`rank-bm25==0.2.2` is the only new runtime dependency: the existing engine has no
BM25 implementation, and the package avoids implementing scoring mathematics
locally. It needs no tokenizer downloads or pretrained model weights. Indexes are
built over the small filtered catalog per request; there is no shared session cache.

## Configuration and latency

Reuse `GEMINI_API_KEY`, optional `GEMINI_MODEL`, optional `ANTHROPIC_API_KEY` /
`ANTHROPIC_MODEL`, and `LLM_TEMPERATURE` from the shared provider. No keys go in
browser code. The existing Anthropic path requires its optional SDK to be installed;
if it is unavailable the co-pilot returns inventory fallback. No new provider or
model default, thinking setting, or monthly spending cap is introduced.

The new API targets ten seconds from authentication start, reserves two seconds
for saving, and caps model output at 1,500 tokens. Provider failover consumes the
same remaining budget. Co-pilot Anthropic calls disable SDK retries. Legacy calls
retain their existing timeout/retry defaults. Deadline checks skip generation if
there is insufficient time and reject late model results.

This is a soft response target: synchronous socket timeouts limit individual waits,
not DNS resolution or the entire response body. Vercel cold starts, platform queues,
authentication and database outages can exceed it. `response_time_ms` measures time
from authentication start to just before persistence; `total_ms` in logs includes
saving. Logs also record retrieval time, provider/model, token counts and fallback
exception class, without prompts, keys or provider error bodies. Inventory retrieval
or persistence failure returns `502`/`503`; no unfinished background tasks are used.

## Rollout and verification

Ship migration `0012_package_copilot.sql` through the existing migration pipeline
before sending requests to the new routes. Do not run a remote database push. The
migration enables owner RLS, grants status-only feedback updates and adds an
invoker-rights atomic save RPC. It does not alter legacy tables or copy demo CSVs.

Run `pytest`, `ruff check .`, and `python -c "from app.main import app"` in `apps/api`.
The focused `test_copilot*.py` checks use mocked auth, database and provider calls.
Validate the migration's RLS and rollback checks with the isolated SQL harness
under `tests/copilot_rls.sql` using the included in-memory PostgreSQL harness:

```sh
npm install --prefix /tmp/copilot-dbcheck @electric-sql/pglite
node tests/check_copilot_db.mjs /tmp/copilot-dbcheck/node_modules/@electric-sql/pglite/dist/index.js
```

This optional check installs no application dependency and never connects to Supabase.

After a separately authorised preview deployment, use a dedicated test package:
measure the first request after inactivity, then at least 20 sequential requests
covering activity, hotel, flight, no-match, and follow-up cases. Record warm/cold
latencies separately, p50/p95, generation mode and fallback frequency. Compare
with the ten-second target; do not infer production latency from mock tests.
