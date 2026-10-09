# Marketplace Out-of-Range Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /marketplace/packages?page=N` past the last page returns `200` with an empty `data` list and correct `meta`, instead of `502`, so the DEV-111 PERF-03 load test measures real failures only.

**Architecture:** PostgREST answers an offset beyond the row count with `416` (`PGRST103`, "Requested range not satisfiable") and a `Content-Range: */<total>` header. The marketplace service's `_call` helper turns every non-OK response into `UpstreamError(502)`. We let `list_marketplace` accept `416` as a normal answer and map it to an empty page; everything else still raises.

**Tech Stack:** Python 3 / FastAPI, `requests` to Supabase PostgREST, pytest with a hand-rolled `FakeRequests` stub, Grafana k6 for the load test.

**Spec:** No separate spec. The problem statement is the DEV-111 re-run finding (2026-10-09):
PERF-03 failed at a steady 10.0% error rate (1,790 of 17,896 requests). Every failure was
`GET /marketplace/packages?page=2&per_page=20` → `502`. The API log shows
`PostgREST get travel_packages failed (416): {"code":"PGRST103","details":"An offset of 20 was requested, but there are only 6 rows."}`.
The web app never hits this: `apps/web/lib/marketplace-api.ts:72` requests `?per_page=100` (page 1 only). The bug is latent for users and shows up in the load test.

## Global Constraints

- Work on branch `fix/perf-findings` (it contains local merge commit `ccec1cb`, develop merged in, **not pushed**). Branch granularity is the human's call per `AGENTS.md`. Confirm before starting whether this goes on `fix/perf-findings` or a new `fix/marketplace-out-of-range-page` branch off `develop`.
- Never `git push` without explicit human approval for that specific push (`AGENTS.md`).
- No AI attribution trailers in commits (`AGENTS.md`).
- Commit format: `<type>(<scope>): <summary>` (e.g. `fix(marketplace): ...`).
- Before committing: API test suite passes in `apps/api` (`AGENTS.md`). No web files change, so web lint/build is not required.
- Run Python from the worktree venv: `apps/api/.venv/bin/pytest`, `apps/api/.venv/bin/uvicorn` (created during the 2026-10-09 run).
- Out of scope: the same `_call` pattern exists in `apps/api/app/{packages,approvals,ai,copilot}/service.py`, so their list endpoints likely 502 past the last page too. Do not change them here. List them in the hand-back as a follow-up.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/api/app/marketplace/service.py` | Modify `_call` (lines 39-51) and `list_marketplace` (lines 131-138) | PostgREST access for the public marketplace |
| `apps/api/tests/test_marketplace_list_search.py` | Add 2 tests after `test_list_filters_and_sort` | Marketplace list/search behaviour via the FastAPI test client |

No new files. Router (`apps/api/app/marketplace/router.py`) is untouched: it already validates `page >= 1` and `1 <= per_page <= 100`.

---

### Task 1: Out-of-range page returns an empty page

**Files:**
- Modify: `apps/api/app/marketplace/service.py:39-51` (`_call`)
- Modify: `apps/api/app/marketplace/service.py:131-138` (`list_marketplace` tail)
- Test: `apps/api/tests/test_marketplace_list_search.py`

**Interfaces:**
- Consumes: existing `FakeResp(payload, status_code=200, headers=None)` and `fake` fixture (`FakeRequests.route(method, url_substring, resp)`) in the test file; existing `_meta(total, page, per_page)` in the service.
- Produces: `_call(method: str, path: str, ok_statuses: tuple[int, ...] = (), **kwargs) -> requests.Response`. Any status in `ok_statuses` is returned instead of raising. Default `()` keeps every current caller's behaviour.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_marketplace_list_search.py`, directly after `test_list_filters_and_sort`:

```python
def test_list_page_past_the_end_is_empty_not_502(fake):
    # PostgREST answers an offset beyond the row count with 416 PGRST103.
    fake.route(
        "GET",
        "travel_packages",
        FakeResp(
            {"code": "PGRST103", "message": "Requested range not satisfiable"},
            status_code=416,
            headers={"Content-Range": "*/6"},
        ),
    )
    resp = client.get("/marketplace/packages?page=2&per_page=20")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"] == []
    assert body["meta"] == {"total": 6, "page": 2, "per_page": 20, "total_pages": 1}


def test_list_other_upstream_errors_still_502(fake):
    fake.route("GET", "travel_packages", FakeResp({"code": "XX000"}, status_code=500))
    resp = client.get("/marketplace/packages")
    assert resp.status_code == 502
```

The second test pins the boundary: only 416 is tolerated, so a real database failure stays a 502.

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `apps/api/.venv/bin/pytest -q apps/api/tests/test_marketplace_list_search.py -k "past_the_end or still_502"`
Expected: `test_list_page_past_the_end_is_empty_not_502` FAILS with `assert 502 == 200`. `test_list_other_upstream_errors_still_502` PASSES (it guards current behaviour).

- [ ] **Step 3: Let `_call` accept extra OK statuses**

In `apps/api/app/marketplace/service.py`, replace `_call` (lines 39-51) with:

```python
def _call(method: str, path: str, ok_statuses=(), **kwargs):
    try:
        response = getattr(requests, method)(
            f"{core.SUPABASE_URL}/rest/v1/{path}", timeout=15, **kwargs
        )
    except RequestException:
        raise UpstreamError(503, "Database unreachable.")
    if not response.ok and response.status_code not in ok_statuses:
        logger.error(
            "PostgREST %s %s failed (%s): %s",
            method, path, response.status_code, response.text,
        )
        raise UpstreamError(502, "Upstream database error.")
    return response
```

- [ ] **Step 4: Map 416 to an empty page in `list_marketplace`**

Replace the tail of `list_marketplace` (the `response = _call(...)` through `return ...`, lines 131-138) with:

```python
    # A page past the end is a 416 from PostgREST; Content-Range still carries
    # the total ("*/6"), so it becomes an empty page rather than an error.
    response = _call(
        "get", "travel_packages", params=params,
        headers={**_anon_headers(), "Prefer": "count=exact"},
        ok_statuses=(416,),
    )
    content_range = response.headers.get("Content-Range", "") if response.headers else ""
    tail = content_range.rsplit("/", 1)[-1]
    total = int(tail) if tail.isdigit() else 0
    rows = [] if response.status_code == 416 else response.json()
    return [_to_summary(r) for r in rows], _meta(total, page, per_page)
```

The existing `Content-Range` parsing already handles `*/6` (the tail after `/` is `6`).

- [ ] **Step 5: Run the marketplace tests**

Run: `apps/api/.venv/bin/pytest -q apps/api/tests/test_marketplace_list_search.py`
Expected: all PASS, including both new tests.

- [ ] **Step 6: Run the full API suite and import smoke-check**

Run: `cd apps/api && .venv/bin/pytest -q && .venv/bin/python -c "import app.main"`
Expected: all tests PASS, import prints nothing and exits 0.

- [ ] **Step 7: Commit (local only)**

```bash
git add apps/api/app/marketplace/service.py apps/api/tests/test_marketplace_list_search.py
git commit -m "fix(marketplace): return an empty page past the last page instead of 502"
```

Do not push.

---

### Task 2: Re-run PERF-03 and confirm

No code changes. This task proves the fix under load and refreshes the report.

**Files:**
- Writes (gitignored): `out/perf-03.json`, `out/run_meta.json`, `docs/testing/performance/reports/2026-10-09-perf-report.html`

**Interfaces:**
- Consumes: Task 1's commit on the current branch; `out/perf-01.json`, `out/perf-02.json`, `out/perf-04.json` from the 2026-10-09 run (kept so the report covers all four scenarios).

- [ ] **Step 1: Start the API with the AI stubbed**

```bash
cd apps/api && LLM_STUB=1 .venv/bin/uvicorn app.main:app --port 8000
```

Run in the background. PERF-03 is API-only, so the web app is not needed. Wait until `curl -s -o /dev/null -w "%{http_code}" localhost:8000/docs` prints `200`.

- [ ] **Step 2: Smoke-check the fixed endpoint**

```bash
curl -s -w "\n%{http_code}\n" "localhost:8000/marketplace/packages?page=2&per_page=20"
```

Expected: `{"data":[],"meta":{"total":6,"page":2,"per_page":20,"total_pages":1}}` and `200`. (`total` is the current live package count; 6 as of 2026-10-09.)

- [ ] **Step 3: Update run metadata with the new SHA**

```bash
echo "{\"date\":\"2026-10-09\",\"sha\":\"$(git rev-parse HEAD)\",\"machine\":\"$(sysctl -n hw.model) (macOS $(sw_vers -productVersion), local)\",\"model\":\"stubbed (LLM_STUB=1)\",\"stub_delay_ms\":0}" > out/run_meta.json
```

- [ ] **Step 4: Run PERF-03**

```bash
k6 run --summary-export=out/perf-03.json apps/test/perf/k6/perf-03-marketplace.js
```

Expected: both thresholds green. `http_req_duration p(95)` well under 2 s (was 165 ms) and `http_req_failed` at `0.00%` (was 9.99%). No `[fail] 502` lines in the console.

If `http_req_failed` is not 0%: read the `[fail]` lines k6 prints (status + URL + body) and the API log. Do not re-run until the cause is understood.

- [ ] **Step 5: Regenerate the report**

```bash
python3 apps/test/perf/report.py out/ docs/testing/performance/reports/2026-10-09-perf-report.html
```

Expected: `wrote docs/testing/performance/reports/2026-10-09-perf-report.html`; PERF-03 now shows PASS.

- [ ] **Step 6: Stop the API**

```bash
pkill -f "uvicorn app.main:app --port 8000"
```

- [ ] **Step 7: Hand back**

Report to the human:
- PERF-03 before/after (p95, error rate, request count) against the 2 s limit.
- The two commits waiting locally on the branch (`ccec1cb` merge, plus Task 1's fix). Ask before pushing.
- Follow-up: `packages`, `approvals`, `ai`, `copilot` list endpoints share the same `_call` pattern and likely 502 past their last page.
- PERF-04 is still blocked by the 20 req/min AI rate limit; it needs its own decision.
