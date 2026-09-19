# Package Vibes & Season Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the vibe and season a creator selects (AI wizard or manual creation) as first-class package fields and return them on every package read surface.

**Architecture:** Two new columns on `travel_packages` (`vibes TEXT[]`, `season TEXT`) with DB CHECK constraints mirroring the wizard's fixed vocabularies. The existing `save_package_details` RPC (single write path for create and update) gains the two payload keys with the same omission/clear semantics as `tags`. The FastAPI layer adds enum-validated inputs (strict-in) and plain lenient output fields (lenient-out), plus the two columns in the PostgREST select strings. Marketplace search needs **no** RPC change: the search flow re-fetches card fields via `_LIST_SELECT` after ranking, so the new columns flow through that second query.

**Tech Stack:** FastAPI + pydantic v2 (`apps/api`), Supabase/PostgREST (SQL migrations in `supabase/migrations/`), pytest with the repo's `FakeRequests` PostgREST stub, OpenAPI 3 contract at `apps/api/openapi.yaml`.

**Spec:** Approved in-chat design (2026-09-19, bounded path — no spec file). The full contract is restated in the Design Summary below; this plan is self-contained.

## Design Summary (the approved contract)

- `vibes: string[]` — allowed values exactly `chill | adventure | luxury | local | foodie | scenic`; default `[]`.
- `season: string | null` — allowed values exactly `spring | summer | autumn | winter`; default `null`.
- Accepted on `POST /packages` and `PUT /packages/{id}`. Update semantics mirror the existing contract: key omitted = unchanged; `vibes: []` clears; `vibes: null` is a 422 (same as `tags`); `season: null` clears (scalar, same as `max_group_size`). Invalid values are a 422 from pydantic.
- Returned on: `GET /packages` (creator's own list), `GET /packages/{id}`, `GET /marketplace/packages`, `GET /marketplace/search`, `GET /marketplace/packages/{id}`.
- Deliberately out of scope: marketplace filtering by vibe/season, adding vibes/season to the `search_tsv` full-text document, backfilling existing rows (they read as `[]`/`null`), `tags` on the creator summary, and all frontend wiring (covered by a handover doc instead).

## Global Constraints

- **Never run `supabase db push`.** Preview with `supabase db push --dry-run` only; the git pipeline applies migrations after merge.
- **Ask the human for approval before every `git commit`; never push without approval.** Commit steps below are proposals — stop and ask first.
- Work on feature branch `feat/package-vibes-season` off `develop`; never commit directly to `develop`.
- Forbidden terminology (AGENTS.md): never write `Flight Centre`, `QUT`, `Group 51`, `fc-marketplace.com`, or the client's real name anywhere. Say "the Marketplace".
- `apps/api/openapi.yaml` is the API contract — it changes in the same PR as the code, with a semver bump (`2.3.0 → 2.4.0`, minor/additive).
- Migrations are append-only files in `supabase/migrations/`; every schema change ships in the same PR as the code depending on it.
- No AI attribution in commit messages (no Co-Authored-By / "Generated with Claude").
- Quality gates before any commit: `cd apps/api && .venv/bin/python -m pytest tests/ -q` passes and `.venv/bin/python -c "import app.main"` succeeds.
- Ponytail posture: laziest change that works; no new dependencies; follow the exact existing patterns quoted in each task.

## File Structure

| File | Change |
|---|---|
| `supabase/migrations/0015_package_vibes_season.sql` | Create — columns + CHECK constraints + re-created `save_package_details` |
| `apps/api/app/packages/schemas.py` | Modify — `Vibe`/`Season` literals; fields on Create/Update/Summary |
| `apps/api/app/packages/service.py` | Modify — `_SUMMARY_SELECT` + create body passthrough |
| `apps/api/app/marketplace/schemas.py` | Modify — fields on `MarketplacePackageSummary` |
| `apps/api/app/marketplace/service.py` | Modify — `_LIST_SELECT` + `_to_summary` |
| `apps/api/tests/test_packages.py` | Modify — create/update/list/detail coverage |
| `apps/api/tests/test_marketplace_list_search.py` | Modify — list + search coverage |
| `apps/api/openapi.yaml` | Modify — schema additions + version bump |
| `docs/frontend-vibes-season-handover.md` | Create — frontend handover |

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch off develop**

```bash
git checkout develop && git pull && git checkout -b feat/package-vibes-season
```

---

### Task 1: Migration — columns, constraints, RPC

**Files:**
- Create: `supabase/migrations/0015_package_vibes_season.sql`
- Reference (read, do not edit): `supabase/migrations/0013_package_editor_persistence.sql` (the `save_package_details` function starts at line 77)

**Interfaces:**
- Produces: `travel_packages.vibes TEXT[] NOT NULL DEFAULT '{}'` and `travel_packages.season TEXT NULL`; `save_package_details` accepts `vibes` (jsonb array) and `season` (string or null) keys in `p_payload` with tags-like semantics.

There is no local Supabase stack, so this task is verified by dry-run + review, and behaviourally by the API tests in Tasks 2–3 (they assert what the service sends to this RPC).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0015_package_vibes_season.sql` beginning with:

```sql
-- ============================================================
-- Vibe & season tags on travel_packages: the wizard's fixed
-- vocabularies become first-class columns, separate from the
-- free-form tags[]. save_package_details learns the two payload
-- keys (same omission/clear semantics as tags; season is a
-- scalar so an explicit null clears it, like max_group_size).
-- search_packages is untouched: the search flow re-fetches card
-- fields by id after ranking, so the new columns flow through
-- that second query.
-- ============================================================

ALTER TABLE public.travel_packages
  ADD COLUMN vibes TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT travel_packages_vibes_allowed CHECK (
      vibes <@ ARRAY['chill','adventure','luxury','local','foodie','scenic']::text[]
    ),
  ADD COLUMN season TEXT
    CONSTRAINT travel_packages_season_allowed CHECK (
      season IN ('spring','summer','autumn','winter')
    );
```

Then copy the **entire** `CREATE OR REPLACE FUNCTION public.save_package_details(...)` statement from `0013_package_editor_persistence.sql` (from line 77 down to and including its closing `$$;`) verbatim into 0015, and apply exactly three edits inside the copy:

**Edit A — the INSERT branch.** Find:

```sql
    INSERT INTO public.travel_packages (
      package_id, creator_id, title, description, destination_country,
      destination_city, duration_days, base_price_aud, max_group_size, tags,
      status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), p_actor_id, p_payload->>'title', p_payload->>'description',
      p_payload->>'destination_country', p_payload->>'destination_city',
      v_duration_days, (p_payload->>'base_price_aud')::BIGINT,
      (p_payload->>'max_group_size')::INTEGER,
      CASE WHEN jsonb_typeof(p_payload->'tags') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ) ELSE '{}'::text[] END,
      'draft', now(), now()
    ) RETURNING package_id INTO v_package_id;
```

Replace with (adds `vibes, season` to the column list and two values):

```sql
    INSERT INTO public.travel_packages (
      package_id, creator_id, title, description, destination_country,
      destination_city, duration_days, base_price_aud, max_group_size, tags,
      vibes, season, status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), p_actor_id, p_payload->>'title', p_payload->>'description',
      p_payload->>'destination_country', p_payload->>'destination_city',
      v_duration_days, (p_payload->>'base_price_aud')::BIGINT,
      (p_payload->>'max_group_size')::INTEGER,
      CASE WHEN jsonb_typeof(p_payload->'tags') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ) ELSE '{}'::text[] END,
      CASE WHEN jsonb_typeof(p_payload->'vibes') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'vibes') x),
        '{}'::text[]
      ) ELSE '{}'::text[] END,
      p_payload->>'season',
      'draft', now(), now()
    ) RETURNING package_id INTO v_package_id;
```

**Edit B — the UPDATE branch.** Find:

```sql
      tags = CASE WHEN jsonb_typeof(p_payload->'tags') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ) ELSE tags END,
      updated_at = now()
```

Replace with (`p_payload->>'season'` is NULL for a JSON null, so `season: null` clears while omission leaves it unchanged):

```sql
      tags = CASE WHEN jsonb_typeof(p_payload->'tags') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ) ELSE tags END,
      vibes = CASE WHEN jsonb_typeof(p_payload->'vibes') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'vibes') x),
        '{}'::text[]
      ) ELSE vibes END,
      season = CASE WHEN p_payload ? 'season'
        THEN p_payload->>'season' ELSE season END,
      updated_at = now()
```

**Edit C — end of file.** After the copied function's closing `$$;`, end the migration with:

```sql
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Verify the copy is faithful**

Run:

```bash
diff <(awk '/^CREATE OR REPLACE FUNCTION public.save_package_details/,/^\$\$;/' supabase/migrations/0013_package_editor_persistence.sql) \
     <(awk '/^CREATE OR REPLACE FUNCTION public.save_package_details/,/^\$\$;/' supabase/migrations/0015_package_vibes_season.sql)
```

Expected: the only hunks are Edits A and B above. Any other difference is a copy error — fix it.

- [ ] **Step 3: Dry-run the migration**

Run: `supabase db push --dry-run`
Expected: 0015 listed as pending; no errors. **Do not run without `--dry-run`.**

- [ ] **Step 4: Propose commit (ask the human first)**

```bash
git add supabase/migrations/0015_package_vibes_season.sql
git commit -m "feat: add vibes and season columns to travel_packages"
```

---

### Task 2: Packages API — schemas, service, tests

**Files:**
- Modify: `apps/api/app/packages/schemas.py` (Create ~line 126, Update ~line 146, Summary ~line 190)
- Modify: `apps/api/app/packages/service.py` (`_SUMMARY_SELECT` line 29, `create_package` body ~line 376)
- Test: `apps/api/tests/test_packages.py`

**Interfaces:**
- Consumes: `save_package_details` payload keys `vibes` / `season` (Task 1).
- Produces: `Vibe = Literal["chill","adventure","luxury","local","foodie","scenic"]` and `Season = Literal["spring","summer","autumn","winter"]` in `app/packages/schemas.py`; `TravelPackageCreate.vibes: list[Vibe]`, `.season: Season | None`; `TravelPackageUpdate.vibes: list[Vibe] | None`, `.season: Season | None`; `TravelPackageSummary.vibes: list[str]`, `.season: str | None` (Detail inherits). Task 3 and the OpenAPI task rely on these exact names.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_packages.py` (reuses the module's existing `fake` fixture, `FakeResp`, `DETAIL_ROW`, `CREATE_BODY`, `_summary_row`, `client`, `PKG`):

```python
# ── Vibes & season ────────────────────────────────────────────


def test_create_persists_vibes_and_season(fake):
    fake.route(
        "POST", "rpc/save_package_details",
        FakeResp({"outcome": "ok", "package_id": PKG}),
    )
    row = copy.deepcopy(DETAIL_ROW)
    row["vibes"] = ["adventure", "foodie"]
    row["season"] = "summer"
    fake.route("GET", "travel_packages", FakeResp([row]))
    body = {**CREATE_BODY, "vibes": ["adventure", "foodie"], "season": "summer"}
    resp = client.post("/packages", json=body)
    assert resp.status_code == 201
    payload = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]
    assert payload["vibes"] == ["adventure", "foodie"]
    assert payload["season"] == "summer"
    assert resp.json()["vibes"] == ["adventure", "foodie"]
    assert resp.json()["season"] == "summer"


def test_create_defaults_vibes_empty_season_null(fake):
    fake.route(
        "POST", "rpc/save_package_details",
        FakeResp({"outcome": "ok", "package_id": PKG}),
    )
    fake.route("GET", "travel_packages", FakeResp([copy.deepcopy(DETAIL_ROW)]))
    resp = client.post("/packages", json=CREATE_BODY)
    assert resp.status_code == 201
    payload = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]
    assert payload["vibes"] == []
    assert payload["season"] is None
    assert resp.json()["vibes"] == []
    assert resp.json()["season"] is None


def test_create_rejects_unknown_vibe_and_season(fake):
    assert (
        client.post("/packages", json={**CREATE_BODY, "vibes": ["party"]}).status_code
        == 422
    )
    assert (
        client.post("/packages", json={**CREATE_BODY, "season": "monsoon"}).status_code
        == 422
    )


def test_update_rejects_null_vibes(fake):
    resp = client.put(f"/packages/{PKG}", json={"vibes": None})
    assert resp.status_code == 422


def test_update_omits_unsent_vibes_and_season(fake):
    fake.route(
        "POST", "rpc/save_package_details",
        FakeResp({"outcome": "ok", "package_id": PKG}),
    )
    fake.route("GET", "travel_packages", FakeResp([copy.deepcopy(DETAIL_ROW)]))
    resp = client.put(f"/packages/{PKG}", json={"title": "Renamed"})
    assert resp.status_code == 200
    payload = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]
    assert "vibes" not in payload
    assert "season" not in payload


def test_update_sends_season_null_to_clear(fake):
    fake.route(
        "POST", "rpc/save_package_details",
        FakeResp({"outcome": "ok", "package_id": PKG}),
    )
    fake.route("GET", "travel_packages", FakeResp([copy.deepcopy(DETAIL_ROW)]))
    resp = client.put(f"/packages/{PKG}", json={"vibes": [], "season": None})
    assert resp.status_code == 200
    payload = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]
    assert payload["vibes"] == []
    assert payload["season"] is None


def test_list_returns_vibes_and_season(fake):
    row = _summary_row(vibes=["chill"], season="winter")
    row["package_media"] = []
    fake.route(
        "GET", "travel_packages",
        FakeResp([row], headers={"Content-Range": "0-0/1"}),
    )
    resp = client.get("/packages")
    assert resp.status_code == 200
    card = resp.json()["data"][0]
    assert card["vibes"] == ["chill"]
    assert card["season"] == "winter"
    select = fake.find("GET", "travel_packages")[0]["params"]["select"]
    assert "vibes" in select and "season" in select


def test_detail_returns_vibes_and_season(fake):
    row = copy.deepcopy(DETAIL_ROW)
    row["vibes"] = ["luxury"]
    row["season"] = "autumn"
    fake.route("GET", "travel_packages", FakeResp([row]))
    resp = client.get(f"/packages/{PKG}")
    assert resp.status_code == 200
    assert resp.json()["vibes"] == ["luxury"]
    assert resp.json()["season"] == "autumn"
```

Note: if any of these fixtures route differently in the existing file (e.g. the create test routes the detail re-fetch with a different substring), mirror the existing create/update tests in the same file — they are the authority on routing, these tests only add the vibes/season angle.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_packages.py -q -k "vibes or season"`
Expected: FAIL — creates succeed without the fields / response lacks `vibes` key (pydantic drops unknown response fields), and the 422 tests fail because unknown values are currently accepted as absent fields.

- [ ] **Step 3: Implement schemas**

In `apps/api/app/packages/schemas.py`, add near the top (after existing imports; `Literal` comes from `typing`):

```python
Vibe = Literal["chill", "adventure", "luxury", "local", "foodie", "scenic"]
Season = Literal["spring", "summer", "autumn", "winter"]
```

`TravelPackageCreate` — after `tags: list[str] = []` add:

```python
    vibes: list[Vibe] = []
    season: Season | None = None
```

`TravelPackageUpdate` — after `tags: list[str] | None = None` add:

```python
    vibes: list[Vibe] | None = None
    season: Season | None = None
```

and in `_reject_explicit_null_collections`, change the tuple to include vibes (season is a scalar — explicit null is a legitimate clear, so it stays out of this list):

```python
            for field in ("tags", "vibes", "flights", "hotels", "activities"):
```

`TravelPackageSummary` — after `cover_image_url: str | None = None` add (lenient-out, plain strings, same posture as the rest of the out-contract):

```python
    vibes: list[str] = []
    season: str | None = None
```

`TravelPackageDetail` inherits `TravelPackageSummary`, so detail is covered.

- [ ] **Step 4: Implement service**

In `apps/api/app/packages/service.py`:

`_SUMMARY_SELECT` (line 29) gains the two columns:

```python
_SUMMARY_SELECT = (
    "package_id,title,destination_country,destination_city,duration_days,"
    "base_price_aud,status,creator_id,created_at,submitted_at,published_at,"
    "vibes,season"
)
```

(`_DETAIL_SELECT` starts with `*` — no change needed.)

`create_package` body dict — after `"tags": payload.tags,` add:

```python
        "vibes": payload.vibes,
        "season": payload.season,
```

`update_package` needs **no change**: `payload.model_dump(exclude_unset=True, ...)` already includes `vibes`/`season` exactly when the caller sent them.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_packages.py -q`
Expected: all PASS (the pre-existing tests too — the new Summary fields default, so old fixtures without `vibes` keys still validate).

- [ ] **Step 6: Propose commit (ask the human first)**

```bash
git add apps/api/app/packages/schemas.py apps/api/app/packages/service.py apps/api/tests/test_packages.py
git commit -m "feat: accept and return vibes/season on package endpoints"
```

---

### Task 3: Marketplace API — schemas, service, tests

**Files:**
- Modify: `apps/api/app/marketplace/schemas.py` (`MarketplacePackageSummary`, line 12)
- Modify: `apps/api/app/marketplace/service.py` (`_LIST_SELECT` line 16, `_to_summary` line 68)
- Test: `apps/api/tests/test_marketplace_list_search.py`

**Interfaces:**
- Consumes: `travel_packages.vibes` / `.season` columns (Task 1). Search needs no RPC change — `search()` re-fetches card fields with `_LIST_SELECT` after ranking and merges via `_to_summary({**row, **by_id...})`, so the columns arrive through the second query.
- Produces: `MarketplacePackageSummary.vibes: list[str]`, `.season: str | None` (and `SearchResult` by inheritance). The marketplace detail endpoint reuses `TravelPackageDetail` from Task 2 — no work here.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_marketplace_list_search.py` (reuses that module's `fake` fixture, `FakeResp`, `LIST_ROW`, `RPC_ROW`, `client`):

```python
# ── Vibes & season ────────────────────────────────────────────


def test_list_returns_vibes_and_season(fake):
    row = copy.deepcopy(LIST_ROW)
    row["vibes"] = ["scenic"]
    row["season"] = "spring"
    fake.route(
        "GET", "travel_packages",
        FakeResp([row], headers={"Content-Range": "0-0/1"}),
    )
    resp = client.get("/marketplace/packages")
    assert resp.status_code == 200
    card = resp.json()["data"][0]
    assert card["vibes"] == ["scenic"]
    assert card["season"] == "spring"
    select = fake.find("GET", "travel_packages")[0]["params"]["select"]
    assert "vibes" in select and "season" in select


def test_search_returns_vibes_and_season(fake):
    fake.route("POST", "rpc/search_packages", FakeResp([copy.deepcopy(RPC_ROW)]))
    row = copy.deepcopy(LIST_ROW)
    row["vibes"] = ["foodie"]
    row["season"] = "summer"
    fake.route("GET", "travel_packages", FakeResp([row]))
    resp = client.get("/marketplace/search", params={"q": "tokyo"})
    assert resp.status_code == 200
    card = resp.json()["data"][0]
    assert card["vibes"] == ["foodie"]
    assert card["season"] == "summer"
```

(Mirror the existing list/search tests in that file for exact routing if they differ — they are the authority; these tests only add the vibes/season angle.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_marketplace_list_search.py -q -k "vibes"`
Expected: FAIL — `KeyError: 'vibes'` on the response card (response model drops unknown fields).

- [ ] **Step 3: Implement**

`apps/api/app/marketplace/schemas.py` — in `MarketplacePackageSummary`, after `tags: list[str] = []` add:

```python
    vibes: list[str] = []
    season: str | None = None
```

`apps/api/app/marketplace/service.py` — `_LIST_SELECT` gains the columns:

```python
_LIST_SELECT = (
    "package_id,title,destination_country,destination_city,duration_days,"
    "base_price_aud,tags,vibes,season,published_at,"
    "creator:profiles!creator_id(full_name,"
    "influencer_profiles(instagram_handle,follower_count)),"
    "package_media(url,is_cover,sort_order)"
)
```

`_to_summary` — after the `"tags"` line add:

```python
        "vibes": row.get("vibes") or [],
        "season": row.get("season"),
```

- [ ] **Step 4: Run the full API suite**

Run: `cd apps/api && .venv/bin/python -m pytest tests/ -q && .venv/bin/python -c "import app.main"`
Expected: all PASS, import succeeds.

- [ ] **Step 5: Propose commit (ask the human first)**

```bash
git add apps/api/app/marketplace/schemas.py apps/api/app/marketplace/service.py apps/api/tests/test_marketplace_list_search.py
git commit -m "feat: expose vibes/season on marketplace list and search"
```

---

### Task 4: OpenAPI contract update

**Files:**
- Modify: `apps/api/openapi.yaml` (version at line 43; `TravelPackageBase` ~line 437; `TravelPackageSummary` ~line 496; `TravelPackageUpdate` properties ~line 663; `MarketplacePackageSummary` ~line 1531)

**Interfaces:**
- Consumes: field names/semantics exactly as implemented in Tasks 2–3.

- [ ] **Step 1: Bump the version**

Line 43: `version: "2.3.0"` → `version: "2.4.0"` (minor — additive fields).

- [ ] **Step 2: Add the fields to the four schemas**

Define the enums inline at each site (the spec has no shared Vibe/Season component yet and two uses don't justify one).

`TravelPackageBase` — after the `tags:` property add:

```yaml
        vibes:
          type: array
          description: Vibe tags from the creation wizard's fixed vocabulary. Defaults to [].
          items:
            type: string
            enum: [chill, adventure, luxury, local, foodie, scenic]
          example: ["adventure", "foodie"]
        season:
          type: string
          nullable: true
          description: Recommended travel season selected at creation. Defaults to null.
          enum: [spring, summer, autumn, winter]
          example: "summer"
```

`TravelPackageSummary` — after `cover_image_url:` add:

```yaml
        vibes:
          type: array
          items:
            type: string
          example: ["adventure", "foodie"]
        season:
          type: string
          nullable: true
          example: "summer"
```

(Detail inherits Summary via `allOf` — nothing to add there.)

`TravelPackageUpdate` — after its `tags:` property add (and extend the schema's `description` prose so the collection-null rule names `vibes` alongside `tags`, and note `season: null` clears):

```yaml
        vibes:
          type: array
          description: Replace semantics like `tags` — omit to leave unchanged, `[]` to clear; explicit `null` is rejected with 422.
          items:
            type: string
            enum: [chill, adventure, luxury, local, foodie, scenic]
        season:
          type: string
          nullable: true
          description: Omit to leave unchanged; explicit `null` clears the season.
          enum: [spring, summer, autumn, winter]
```

`MarketplacePackageSummary` — after its `tags:` property add:

```yaml
        vibes:
          type: array
          items:
            type: string
          example: ["scenic"]
        season:
          type: string
          nullable: true
          example: "spring"
```

- [ ] **Step 3: Validate the YAML parses**

Run: `cd apps/api && .venv/bin/python -c "import yaml; yaml.safe_load(open('openapi.yaml')); print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Propose commit (ask the human first)**

```bash
git add apps/api/openapi.yaml
git commit -m "docs: add vibes/season to package API contract (2.4.0)"
```

---

### Task 5: Frontend handover document

**Files:**
- Create: `docs/frontend-vibes-season-handover.md`

**Interfaces:**
- Consumes: the contract exactly as shipped in Tasks 2–4.

- [ ] **Step 1: Write the handover doc**

```markdown
# Frontend handover: package vibes & season

The API (contract v2.4.0, see `apps/api/openapi.yaml` / the deployed Swagger UI
at `GET /docs-ui`) now persists the vibe and season selections as first-class
package fields, separate from free-form `tags`. Backend is done; this doc is
what the web app needs to wire up.

## The fields

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `vibes` | `string[]` | `chill`, `adventure`, `luxury`, `local`, `foodie`, `scenic` | `[]` |
| `season` | `string \| null` | `spring`, `summer`, `autumn`, `winter` | `null` |

Values outside the enums are rejected with a 422. These match the AI wizard's
existing `WizardSelection.vibes` / `.season` ids in `apps/web/lib/ai/itinerary.ts`
exactly — no mapping layer needed.

## Writing

- `POST /packages` — send `vibes` and `season` alongside the existing body.
  - **AI wizard**: `wizardDraftToPackageInput` currently drops both selections;
    map `draft.vibes` → `vibes` and `draft.season` → `season` there.
  - **Manual create form**: add the same two fields to the create payload
    (multi-select for vibes, single optional select for season).
- `PUT /packages/{id}` — same semantics as `tags`: omit the key to leave
  unchanged, `vibes: []` to clear. `vibes: null` is a 422. `season: null`
  clears the season (it's a scalar, like `max_group_size`).

## Reading

Both fields are returned everywhere a package is:

- `GET /packages` (creator dashboard cards)
- `GET /packages/{id}` (editor / own detail)
- `GET /marketplace/packages` and `GET /marketplace/search` (public cards)
- `GET /marketplace/packages/{id}` (public detail)

Packages created before this change return `vibes: []` and `season: null` —
render nothing rather than a placeholder badge.

## Not included (by design)

- No marketplace filtering by vibe/season, and full-text search does not match
  on vibe/season words — the existing `tags` filter is unchanged. Ask for a
  follow-up story if a filter UI is wanted.
- No backfill of existing packages.
```

- [ ] **Step 2: Check forbidden terms**

Run: `git diff --cached --stat; grep -riE "flight ?centre|qut|group 51|fc-marketplace" docs/frontend-vibes-season-handover.md; echo "exit=$?"`
Expected: grep exits 1 (no matches).

- [ ] **Step 3: Propose commit (ask the human first)**

```bash
git add docs/frontend-vibes-season-handover.md
git commit -m "docs: frontend handover for package vibes/season"
```

---

### Task 6: Final verification & PR

**Files:** none new

- [ ] **Step 1: Full gates**

Run: `cd apps/api && .venv/bin/python -m pytest tests/ -q && .venv/bin/python -c "import app.main" && ruff check .`
Expected: all green.

- [ ] **Step 2: Self-review the diff**

Run `git diff develop...HEAD` and check: migration is append-only and matches the code's payload keys; spec matches the pydantic models field-for-field; no forbidden terms; no stray files.

- [ ] **Step 3: Propose the PR (ask the human before pushing)**

PR from `feat/package-vibes-season` into `develop`. Body must state what changed, why, and how it was verified (the pytest/dry-run commands above and their results). Do **not** push without the human's approval.
