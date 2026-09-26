# Relative (Date-Free) Reference Flights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `POST /packages` and `PUT /packages/{id}` accept flights placed on a relative schedule (`day_number` + `departure_time`) with no calendar datetimes, and return those fields on package detail reads.

**Architecture:** Pure API-layer change. `FlightInput` makes the datetime pair optional, adds `departure_time` / `arrival_time` / `duration_minutes`, and enforces an either/or rule (datetime pair, or `day_number` + `departure_time`). The `save_package_details` RPC already stores each component whole in `package_flights.details` (jsonb) and already range-checks `day_number`, so no migration or RPC change. `_flight_from_row` returns the three new fields from `details`; creator and marketplace detail both route through `_to_detail`.

**Tech Stack:** FastAPI + pydantic v2 (`apps/api`), pytest with the repo's `FakeRequests` PostgREST stub, OpenAPI 3 contract at `apps/api/openapi.yaml`.

**Spec:** `docs/superpowers/specs/2026-09-26-relative-flight-schedule-design.md` (issue #75).

## Global Constraints

- Branch: `fix/75-relative-flight-schedule` (already created off `origin/develop`, spec committed as `071abb9`). Never commit to `develop`/`main`.
- **Ask the human before every commit and every push.** No `Co-Authored-By` or "Generated with" trailers. Commit format: `<type>: <imperative summary>`.
- No Supabase migration, no RPC change, no web (`apps/web`) change. Never run `supabase db push`.
- Forbidden terms (AGENTS.md) must not appear in code, docs, or commit messages. The pre-commit hook in `.githooks/` enforces this; never spell the terms out, even in a grep command.
- `departure_time` / `arrival_time` reuse the existing `_TIME_RE` (`HH:MM`, 00:00–23:59). `duration_minutes` ≥ 1.
- No ordering check between `departure_time` and `arrival_time` (local times in different zones).
- `origin_iata`, `destination_iata`, `airline` stay required.
- Exact validator messages: `flight requires departure_datetime/arrival_datetime or day_number/departure_time` and `flight requires both departure_datetime and arrival_datetime`.
- OpenAPI `info.version`: `2.4.0` → `2.5.0`.
- Run tests from `apps/api`: `.venv/bin/python -m pytest ...`. Baseline: `tests/test_packages.py` 32 passed.

## File Map

| File | Responsibility | Task |
|---|---|---|
| `apps/api/app/packages/schemas.py` | `FlightInput` (accept), `FlightDetailOut` (return) | 1, 2 |
| `apps/api/app/packages/service.py` | `_flight_from_row` read-back | 2 |
| `apps/api/openapi.yaml` | published contract + version | 2 |
| `apps/api/tests/test_packages.py` | all new tests | 1, 2 |
| `apps/api/tests/test_package_editor_contract.py` | version pin `2.4.0` → `2.5.0` | 2 |

---

### Task 1: Accept date-free reference flights

**Files:**
- Modify: `apps/api/app/packages/schemas.py:24-49` (`FlightInput`)
- Test: `apps/api/tests/test_packages.py` (append at end of file)

**Interfaces:**
- Consumes: existing `_TIME_RE`, `_reject_duplicate_media_ids` in `schemas.py`; existing `fake` fixture, `FakeResp`, `CREATE_BODY`, `DETAIL_ROW`, `PKG`, `client` in `test_packages.py`.
- Produces: `FlightInput` fields `departure_time: str | None`, `arrival_time: str | None`, `duration_minutes: int | None`; `departure_datetime` / `arrival_datetime` now `str | None`. Test helpers `RELATIVE_FLIGHT` (dict) and `_validation_msgs(resp) -> str`, reused by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_packages.py`:

```python
# ─── Relative (date-free) reference flights — issue #75 ──────────────────────

RELATIVE_FLIGHT = {
    "origin_iata": "SYD",
    "destination_iata": "NRT",
    "airline": "JL",
    "day_number": 1,
    "departure_time": "21:00",
    # Next-day local arrival: earlier clock time than departure is valid.
    "arrival_time": "06:00",
    "duration_minutes": 585,
}


def _validation_msgs(resp):
    return " ".join(e["msg"] for e in resp.json()["details"]["errors"])


def _relative_body(**flight_over):
    return {
        **CREATE_BODY,
        "duration_days": 4,
        "flights": [{**RELATIVE_FLIGHT, **flight_over}],
        "hotels": [
            {"hotel_name": "Shinjuku Stay", "city": "Tokyo", "check_in_day": 1, "check_out_day": 4}
        ],
        "activities": [
            {"activity_name": "Ramen tour", "city": "Tokyo", "day_number": 2, "start_time": "14:00"}
        ],
    }


def test_create_accepts_undated_flight_hotel_and_activity(fake):
    fake.route("POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG}))
    fake.route("GET", "travel_packages", FakeResp([copy.deepcopy(DETAIL_ROW)]))

    resp = client.post("/packages", json=_relative_body())
    assert resp.status_code == 201, resp.json()

    flight = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]["flights"][0]
    assert flight["day_number"] == 1
    assert flight["departure_time"] == "21:00"
    assert flight["arrival_time"] == "06:00"
    assert flight["duration_minutes"] == 585
    # The backend never invents placeholder dates.
    assert flight["departure_datetime"] is None
    assert flight["arrival_datetime"] is None


def test_update_accepts_undated_flight(fake):
    fake.route("POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG}))
    fake.route("GET", "travel_packages", FakeResp([copy.deepcopy(DETAIL_ROW)]))

    resp = client.put(f"/packages/{PKG}", json={"flights": [RELATIVE_FLIGHT]})
    assert resp.status_code == 200, resp.json()
    flight = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]["flights"][0]
    assert flight["departure_time"] == "21:00"


def test_create_still_accepts_dated_flight(fake):
    fake.route("POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG}))
    fake.route("GET", "travel_packages", FakeResp([copy.deepcopy(DETAIL_ROW)]))

    resp = client.post("/packages", json=CREATE_BODY)
    assert resp.status_code == 201
    flight = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]["flights"][0]
    assert flight["departure_datetime"] == "2026-03-01T09:00:00+00:00"
    assert flight["departure_time"] is None


@pytest.mark.parametrize("missing", ["day_number", "departure_time"])
def test_create_rejects_flight_without_dates_or_relative_schedule(fake, missing):
    flight = {k: v for k, v in RELATIVE_FLIGHT.items() if k != missing}
    resp = client.post("/packages", json={**CREATE_BODY, "flights": [flight]})
    assert resp.status_code == 422
    assert "day_number/departure_time" in _validation_msgs(resp)
    assert fake.find("POST", "rpc/save_package_details") == []


def test_create_rejects_flight_with_only_one_datetime(fake):
    flight = {**RELATIVE_FLIGHT, "departure_datetime": "2026-03-01T09:00:00+00:00"}
    resp = client.post("/packages", json={**CREATE_BODY, "flights": [flight]})
    assert resp.status_code == 422
    assert "both departure_datetime and arrival_datetime" in _validation_msgs(resp)


@pytest.mark.parametrize(
    "over", [{"departure_time": "9:00"}, {"departure_time": "25:00"}, {"arrival_time": "6pm"},
             {"duration_minutes": 0}]
)
def test_create_rejects_malformed_relative_flight_fields(fake, over):
    resp = client.post("/packages", json=_relative_body(**over))
    assert resp.status_code == 422
    assert fake.find("POST", "rpc/save_package_details") == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_packages.py -q -k "undated or dated_flight or relative_schedule or one_datetime or malformed_relative"`
Expected: FAIL — `test_create_accepts_undated_flight_hotel_and_activity` and `test_update_accepts_undated_flight` get 422 (`departure_datetime` Field required); `test_create_still_accepts_dated_flight` fails on `flight["departure_time"]` (KeyError); message assertions fail because the 422 text is "Field required". The `9:00`/`25:00`/`6pm`/`0` cases may already 422 for the wrong reason — that's fine.

- [ ] **Step 3: Implement**

In `apps/api/app/packages/schemas.py`, replace the `FlightInput` class (currently lines 24-49) with:

```python
class FlightInput(BaseModel):
    origin_iata: str = Field(min_length=3, max_length=3)
    destination_iata: str = Field(min_length=3, max_length=3)
    airline: str
    flight_number: str | None = None
    # Dated flights send the datetime pair. Reusable packages send a
    # reference flight on a relative schedule (day_number + local clock
    # times) instead — buyers pick real dates later (spec 2026-09-26).
    departure_datetime: str | None = None
    arrival_datetime: str | None = None
    departure_time: str | None = Field(default=None, pattern=_TIME_RE.pattern)
    arrival_time: str | None = Field(default=None, pattern=_TIME_RE.pattern)
    duration_minutes: int | None = Field(default=None, ge=1)
    cabin_class: str | None = None
    price_aud: int | None = Field(default=None, ge=0)
    day_number: int | None = Field(default=None, ge=1)
    sequence_order: int | None = Field(default=None, ge=1)
    notes: str | None = None
    media_ids: list[UUID] = []
    source_id: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "FlightInput":
        _reject_duplicate_media_ids(self.media_ids)
        if self.departure_datetime is None and self.arrival_datetime is None:
            # No ordering check: departure/arrival clock times are local to
            # different time zones (SYD 21:00 -> NRT 06:00 is valid).
            if self.day_number is None or self.departure_time is None:
                raise ValueError(
                    "flight requires departure_datetime/arrival_datetime or "
                    "day_number/departure_time"
                )
            return self
        if self.departure_datetime is None or self.arrival_datetime is None:
            raise ValueError("flight requires both departure_datetime and arrival_datetime")
        try:
            departure = datetime.fromisoformat(self.departure_datetime)
            arrival = datetime.fromisoformat(self.arrival_datetime)
        except ValueError as exc:
            raise ValueError(f"invalid flight timestamp: {exc}") from exc
        if arrival <= departure:
            raise ValueError("arrival_datetime must be after departure_datetime")
        return self
```

`create_package` / `update_package` in `service.py` already `model_dump(mode="json")` every flight, so the new fields reach the RPC payload with no service change.

- [ ] **Step 4: Run the full package suite**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_packages.py tests/test_package_editor_contract.py -q`
Expected: all pass (32 existing + 10 new in `test_packages.py`, plus the editor contract suite).

- [ ] **Step 5: Commit (ask the human first)**

```bash
git add apps/api/app/packages/schemas.py apps/api/tests/test_packages.py
git commit -m "fix: accept date-free reference flights on package save"
```

---

### Task 2: Return relative flight fields and publish the contract

Read-back and `openapi.yaml` ship together: `test_openapi_component_schema_properties_match_runtime_model` in `tests/test_package_editor_contract.py` requires the `FlightDetail` properties documented in the YAML (inherited from `FlightInput` via `allOf` + `$ref`) to equal `FlightDetailOut`'s fields exactly, so neither half passes alone. `FlightDetail` itself is not edited — it inherits from `FlightInput`.

**Files:**
- Modify: `apps/api/app/packages/schemas.py` (`FlightDetailOut`, after `arrival_datetime`)
- Modify: `apps/api/app/packages/service.py:161-200` (`_flight_from_row`, both branches)
- Modify: `apps/api/openapi.yaml` — `info.version` (line ~43) and `components.schemas.FlightInput` (line ~748)
- Modify: `apps/api/tests/test_package_editor_contract.py:336-338` (`test_openapi_version_bumped_for_this_change` pins the version)
- Test: `apps/api/tests/test_packages.py` (append)

**Interfaces:**
- Consumes: `RELATIVE_FLIGHT` from Task 1; `DETAIL_ROW`, `fake`, `FakeResp`, `PKG`, `client` fixtures; validator messages from Task 1.
- Produces: `FlightDetailOut.departure_time: str | None`, `.arrival_time: str | None`, `.duration_minutes: int | None`; `_flight_from_row(pf)` dict gains the same three keys; OpenAPI `info.version` `2.5.0`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_packages.py`:

```python
def test_detail_returns_relative_flight_fields(fake):
    row = copy.deepcopy(DETAIL_ROW)
    row["package_flights"] = [
        {
            "id": "pf-relative",
            "flight_id": None,
            "day_number": 1,
            "sequence_order": 1,
            "notes": None,
            "details": {**RELATIVE_FLIGHT, "sequence_order": 1, "media_ids": []},
            "flights": None,
        }
    ]
    fake.route("GET", "travel_packages", FakeResp([row]))

    resp = client.get(f"/packages/{PKG}")
    assert resp.status_code == 200
    flight = resp.json()["flights"][0]
    assert flight["day_number"] == 1
    assert flight["departure_time"] == "21:00"
    assert flight["arrival_time"] == "06:00"
    assert flight["duration_minutes"] == 585
    assert flight["departure_datetime"] is None


def test_detail_legacy_flight_has_null_relative_fields(fake):
    fake.route("GET", "travel_packages", FakeResp([copy.deepcopy(DETAIL_ROW)]))
    flight = client.get(f"/packages/{PKG}").json()["flights"][0]
    assert flight["departure_datetime"] == "2026-03-01T09:00:00+00:00"
    assert flight["departure_time"] is None
    assert flight["arrival_time"] is None
    assert flight["duration_minutes"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Also update the version pin in `apps/api/tests/test_package_editor_contract.py` (it will fail until Step 3 bumps the YAML):

```python
def test_openapi_version_bumped_for_this_change():
    spec = _load_openapi()
    assert spec["info"]["version"] == "2.5.0"
```

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_packages.py tests/test_package_editor_contract.py -q -k "relative_flight_fields or null_relative_fields or version_bumped"`
Expected: FAIL — both detail tests with `KeyError: 'departure_time'` (the response model drops unknown keys) and `assert '2.4.0' == '2.5.0'`.

- [ ] **Step 3: Implement**

In `apps/api/app/packages/schemas.py`, `FlightDetailOut`, add directly after `arrival_datetime: str | None = None`:

```python
    departure_time: str | None = None
    arrival_time: str | None = None
    duration_minutes: int | None = None
```

In `apps/api/app/packages/service.py`, `_flight_from_row`, **details branch** — add after the `"arrival_datetime": details.get("arrival_datetime"),` line:

```python
            "departure_time": details.get("departure_time"),
            "arrival_time": details.get("arrival_time"),
            "duration_minutes": details.get("duration_minutes"),
```

**Legacy catalog branch** (`details IS NULL`, the dict built from `catalog`) — add after its `"arrival_datetime": catalog.get("arrival_datetime"),` line:

```python
        "departure_time": None,
        "arrival_time": None,
        "duration_minutes": None,
```

In `apps/api/openapi.yaml`:

(a) Under `info:`, change `  version: "2.4.0"` to `  version: "2.5.0"`. Leave the other `version:` key further down the file alone.

(b) Replace the `FlightInput` header:

```yaml
    FlightInput:
      type: object
      required: [origin_iata, destination_iata, airline, departure_datetime, arrival_datetime]
      properties:
```

with:

```yaml
    FlightInput:
      type: object
      required: [origin_iata, destination_iata, airline]
      description: |
        A package flight is a reference flight: it defines the intended route
        and itinerary flow, not a seat every buyer takes. Buyers choose real
        travel dates and departure airport later.
        Supply either `departure_datetime`/`arrival_datetime` (both together;
        dated flights), or `day_number` + `departure_time` (relative
        schedule, no calendar dates). Otherwise 422 "flight requires
        departure_datetime/arrival_datetime or day_number/departure_time".
      properties:
```

(c) Replace the `departure_datetime` and `arrival_datetime` property blocks under `FlightInput` (the first one currently says "Flights are not eligible for the undated/relative-day placeholders…") with:

```yaml
        departure_datetime:
          type: string
          format: date-time
          nullable: true
          description: Dated flights only. Required together with arrival_datetime.
          example: "2025-07-14T06:30:00+10:00"
        arrival_datetime:
          type: string
          format: date-time
          nullable: true
          description: Dated flights only. Must be strictly after departure_datetime.
          example: "2025-07-14T11:45:00+08:00"
        departure_time:
          type: string
          pattern: '^([01]\d|2[0-3]):[0-5]\d$'
          nullable: true
          description: Local clock time at the origin (HH:MM). Required with day_number when no datetimes are supplied.
          example: "21:00"
        arrival_time:
          type: string
          pattern: '^([01]\d|2[0-3]):[0-5]\d$'
          nullable: true
          description: Local clock time at the destination (HH:MM). Not compared with departure_time — they are in different time zones.
          example: "06:00"
        duration_minutes:
          type: integer
          minimum: 1
          nullable: true
          description: Elapsed flight time; disambiguates overnight arrivals.
          example: 585
```

(d) Change the `FlightInput.day_number` description to:

```yaml
          description: Timeline placement (1..duration_days, checked on save → 422 SAVE_PRECONDITION_FAILED). Required with departure_time for relative-schedule flights.
```

- [ ] **Step 4: Run the full API suite and contract checks**

Creator and marketplace detail share `_to_detail`; the contract tests compare YAML with the runtime models.

```bash
cd apps/api && .venv/bin/python -m pytest tests -q
.venv/bin/python -c "import yaml; d=yaml.safe_load(open('openapi.yaml')); s=d['components']['schemas']['FlightInput']; assert d['info']['version']=='2.5.0'; assert s['required']==['origin_iata','destination_iata','airline']; assert {'departure_time','arrival_time','duration_minutes'} <= s['properties'].keys(); print('ok')"
```

Expected: full suite passes (includes `test_openapi_component_schema_properties_match_runtime_model[FlightDetail-…]`, `test_openapi_version_bumped_for_this_change`, `test_openapi_yaml_served_and_valid`); `ok`. Forbidden terms are enforced by `.githooks/pre-commit` (enabled via `core.hooksPath`) at commit time — same regex as the CI `forbidden-terms` job; never bypass with `--no-verify`.

- [ ] **Step 5: Commit (ask the human first)**

```bash
git add apps/api/app/packages/schemas.py apps/api/app/packages/service.py apps/api/openapi.yaml apps/api/tests/test_packages.py apps/api/tests/test_package_editor_contract.py
git commit -m "fix: return relative flight times and document them in openapi 2.5.0"
```

---

## Final verification (after Task 2)

- [ ] Reproduce the original bug is gone — the exact payload the web AI wizard sends for Tokyo:

```bash
cd apps/api && .venv/bin/python -c "
from app.packages.schemas import TravelPackageCreate
TravelPackageCreate(title='Tokyo trip', description='d', destination_country='Japan', destination_city='Tokyo',
  duration_days=4, base_price_aud=0,
  flights=[dict(origin_iata='SYD', destination_iata='NRT', airline='JAL', departure_time='09:00',
    arrival_time='18:00', duration_minutes=540, day_number=1, sequence_order=1, media_ids=[])])
print('Tokyo payload OK')"
```
Expected: `Tokyo payload OK` (before this change: `flights.0.departure_datetime Field required`).

- [ ] Optional manual check (needs local stack via `./dev.sh`): AI wizard → Tokyo, Japan / Luxury / Short trip / Spring → package is created and opens in the editor; Save in the editor succeeds.
- [ ] Self-review with `/code-review` or `/scrutinize` before opening the PR (AGENTS.md).
- [ ] Ask the human before `git push -u origin fix/75-relative-flight-schedule` and before opening the PR to `develop`. PR body: what/why/how verified; `Closes #75`; note that PR #81 commit `3b99cf1` should be dropped.
