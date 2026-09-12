import copy
import types

import pytest
from fastapi.testclient import TestClient

from app import core
from app.main import app
from app.packages import service

client = TestClient(app)

UID = "u0000000-0000-0000-0000-000000000001"
PKG = "b0000000-0000-0000-0000-000000000001"
USER_HEADERS = {"apikey": "anon-key", "Authorization": "Bearer user-token"}


class FakeResp:
    def __init__(self, payload, status_code=200, headers=None):
        self._payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.headers = headers or {}
        self.text = str(payload)

    def json(self):
        # Fresh copy per call, like real Response.json() re-parsing the
        # body — the service mutates rows, and fixtures are shared.
        return copy.deepcopy(self._payload)


class FakeRequestException(Exception):
    """Stand-in for requests.RequestException — must NOT be bare Exception,
    or `except requests.RequestException` swallows every fake failure."""


class FakeRequests:
    """Queue of (method, url_substring, response) consumed first-match-wins."""

    RequestException = FakeRequestException

    def __init__(self):
        self.calls = []
        self.queue = []

    def route(self, method, substr, resp):
        self.queue.append([method, substr, resp])

    def _call(self, method, url, params=None, headers=None, json=None, timeout=None):
        self.calls.append(
            {
                "method": method,
                "url": url,
                "params": params or {},
                "headers": headers or {},
                "json": json,
            }
        )
        for entry in self.queue:
            if entry[0] == method and entry[1] in url:
                self.queue.remove(entry)
                return entry[2]
        raise AssertionError(f"unrouted {method} {url}")

    def get(self, url, **kw):
        return self._call("GET", url, **kw)

    def post(self, url, **kw):
        return self._call("POST", url, **kw)

    def patch(self, url, **kw):
        return self._call("PATCH", url, **kw)

    def delete(self, url, **kw):
        return self._call("DELETE", url, **kw)

    def find(self, method, substr):
        return [c for c in self.calls if c["method"] == method and substr in c["url"]]


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(core, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    fr = FakeRequests()
    monkeypatch.setattr(
        service,
        "requests",
        types.SimpleNamespace(
            get=fr.get,
            post=fr.post,
            patch=fr.patch,
            delete=fr.delete,
            RequestException=FakeRequestException,
        ),
    )
    app.dependency_overrides[core.require_user_ctx] = lambda: {
        "uid": UID,
        "headers": dict(USER_HEADERS),
    }
    yield fr
    app.dependency_overrides.clear()


DETAIL_ROW = {
    "package_id": PKG,
    "title": "Tokyo Week",
    "description": "Seven days of ramen.",
    "destination_country": "Japan",
    "destination_city": "Tokyo",
    "duration_days": 7,
    "base_price_aud": 2999,
    "max_group_size": 8,
    "tags": ["food"],
    "status": "draft",
    "creator_id": UID,
    "created_at": "2026-01-01T00:00:00+00:00",
    "submitted_at": None,
    "published_at": None,
    "creator": {"full_name": "Mia Tanaka", "influencer_profiles": []},
    # Already ordered as PostgREST would return it under package_media.order
    # (is_cover.desc) — the cover must come first for _cover_url to be right.
    "package_media": [
        {"media_id": "m1", "url": "https://img/1.jpg", "is_cover": True},
        {"media_id": "m2", "url": "https://img/2.jpg", "is_cover": False},
    ],
    "package_days": [{"day_number": 1, "title": "Arrive"}],
    "package_flights": [
        {
            "flight_id": "f1",
            "sequence_order": 1,
            "flights": {
                "origin": "SYD",
                "destination": "HND",
                "airline": "QF",
                "flight_number": "QF25",
                "departure_datetime": "2026-03-01T09:00:00+00:00",
                "arrival_datetime": "2026-03-01T18:00:00+00:00",
                "cabin_class": "economy",
                "price_aud": 1200,
            },
        }
    ],
    "package_hotels": [
        {
            "hotel_id": "h1",
            "check_in_date": "2026-03-01",
            "check_out_date": "2026-03-04",
            "nights": 3,
            "hotels": {
                "hotel_name": "Shibuya Inn",
                "star_rating": 4,
                "city": "Tokyo",
                "address": "1-1",
                "price_per_night_aud": 200,
                "room_type": "double",
            },
        }
    ],
    "package_activities": [
        {
            "activity_id": "a1",
            "sequence_order": 1,
            "activity_date": "2026-03-02",
            "activities": {
                "activity_name": "Ramen tour",
                "city": "Tokyo",
                "duration_hours": 3.0,
                "price_aud": 90,
                "description": "Slurp",
                "booking_required": True,
            },
        }
    ],
}

CREATE_BODY = {
    "title": "Tokyo Week",
    "description": "Seven days of ramen.",
    "destination_country": "Japan",
    "destination_city": "Tokyo",
    "duration_days": 7,
    "base_price_aud": 2999,
    "tags": ["food"],
    "flights": [
        {
            "origin_iata": "SYD",
            "destination_iata": "HND",
            "airline": "QF",
            "flight_number": "QF25",
            "departure_datetime": "2026-03-01T09:00:00+00:00",
            "arrival_datetime": "2026-03-01T18:00:00+00:00",
            "cabin_class": "economy",
            "price_aud": 1200,
        },
        {
            "origin_iata": "HND",
            "destination_iata": "SYD",
            "airline": "QF",
            "flight_number": "QF26",
            "departure_datetime": "2026-03-08T20:00:00+00:00",
            "arrival_datetime": "2026-03-09T08:00:00+00:00",
            "cabin_class": "economy",
            "price_aud": 1300,
        },
    ],
    "hotels": [
        {
            "hotel_name": "Shibuya Inn",
            "star_rating": 4,
            "city": "Tokyo",
            "check_in_date": "2026-03-01",
            "check_out_date": "2026-03-04",
            "price_per_night_aud": 200,
            "room_type": "double",
        },
        {
            "hotel_name": "Kyoto Ryokan",
            "star_rating": 5,
            "city": "Kyoto",
            "check_in_date": "2026-03-04",
            "check_out_date": "2026-03-08",
            "price_per_night_aud": 320,
            "room_type": "suite",
        },
    ],
    "activities": [
        {
            "activity_name": "Ramen tour",
            "activity_date": "2026-03-02",
            "city": "Tokyo",
            "duration_hours": 3.0,
            "price_aud": 90,
            "booking_required": True,
        },
        {
            "activity_name": "Temple walk",
            "activity_date": "2026-03-05",
            "city": "Kyoto",
            "duration_hours": 2.0,
            "price_aud": 45,
            "booking_required": False,
        },
    ],
}


def _summary_row(**over):
    row = {
        "package_id": PKG,
        "title": "Tokyo Week",
        "destination_country": "Japan",
        "destination_city": "Tokyo",
        "duration_days": 7,
        "base_price_aud": 2999,
        "status": "draft",
        "creator_id": UID,
        "created_at": "2026-01-01T00:00:00+00:00",
        "submitted_at": None,
        "published_at": None,
    }
    row.update(over)
    return row


def test_list_defaults(fake):
    row = _summary_row()
    row["package_media"] = [{"url": "https://img/1.jpg", "is_cover": True}]
    fake.route(
        "GET", "travel_packages", FakeResp([row], headers={"Content-Range": "0-19/45"})
    )
    resp = client.get("/packages")
    assert resp.status_code == 200
    call = fake.find("GET", "travel_packages")[0]
    assert call["params"]["limit"] == 20
    assert call["params"]["offset"] == 0
    assert call["params"]["order"] == "created_at.desc"
    assert call["params"]["creator_id"] == "eq." + UID
    assert call["params"]["package_media.order"].startswith("is_cover.desc")
    assert call["headers"]["Prefer"] == "count=exact"
    body = resp.json()
    assert body["meta"] == {"total": 45, "page": 1, "per_page": 20, "total_pages": 3}
    assert body["data"][0]["cover_image_url"] == "https://img/1.jpg"


def test_list_unauthorized(monkeypatch):
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(core, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    assert core.require_user_ctx not in app.dependency_overrides
    unauth = client.get("/packages")
    assert unauth.status_code == 401
    assert unauth.json()["error_code"] == "UNAUTHORIZED"


def test_list_filter_sort_page(fake):
    fake.route("GET", "travel_packages", FakeResp([], headers={"Content-Range": "*/0"}))
    resp = client.get("/packages?status=draft&sort=price_asc&page=2&per_page=20")
    assert resp.status_code == 200
    params = fake.find("GET", "travel_packages")[0]["params"]
    assert params["status"] == "eq.draft"
    assert params["order"] == "base_price_aud.asc"
    assert params["offset"] == 20


def test_create_calls_save_rpc_with_full_payload(fake):
    fake.route(
        "POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG})
    )
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))

    body = dict(CREATE_BODY)
    body["days"] = [
        {"day_number": 1, "title": "Arrive", "summary": "Land and eat ramen.", "meta": "hero"},
        {"day_number": 3, "title": "Kyoto", "summary": None},
    ]
    resp = client.post("/packages", json=body)
    assert resp.status_code == 201

    rpc = fake.find("POST", "rpc/save_package_details")[0]
    # Server-only service-role headers, never the caller's JWT — and the
    # actor comes from the validated bearer token, never request JSON.
    assert rpc["headers"]["Authorization"] == "Bearer service-key"
    assert rpc["json"]["p_actor_id"] == UID
    assert rpc["json"]["p_package_id"] is None

    payload = rpc["json"]["p_payload"]
    assert payload["title"] == "Tokyo Week"
    flights = payload["flights"]
    assert flights[0]["origin_iata"] == "SYD"
    assert flights[0]["media_ids"] == []
    hotels = payload["hotels"]
    assert hotels[0]["check_in_date"] == "2026-03-01"
    assert hotels[0]["check_out_date"] == "2026-03-04"
    acts = payload["activities"]
    assert acts[1]["activity_date"] == "2026-03-05"
    days = payload["days"]
    # Non-contiguous day numbers pass through untouched — exact-number
    # replacement, not length-based trimming.
    assert [d["day_number"] for d in days] == [1, 3]
    assert days[0]["meta"] == "hero"

    assert resp.json()["flights"][0]["origin_iata"] == "SYD"


def test_create_missing_required(fake):
    body = {k: v for k, v in CREATE_BODY.items() if k != "title"}
    resp = client.post("/packages", json=body)
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VALIDATION_ERROR"


def test_create_database_failure_never_reports_success(fake):
    fake.route("POST", "rpc/save_package_details", FakeResp({"message": "boom"}, 500))

    resp = client.post("/packages", json=CREATE_BODY)
    assert resp.status_code == 502
    assert resp.json()["message"] == "Upstream database error."
    # The RPC call is the only mutation; a failed transaction means no
    # detail read follows, so nothing here could look like success.
    assert fake.find("GET", "travel_packages") == []


def test_create_precondition_failure_never_reports_success(fake):
    fake.route(
        "POST",
        "rpc/save_package_details",
        FakeResp(
            {
                "outcome": "precondition_failed",
                "details": {"failures": ["flight day_number must be between 1 and duration_days"]},
            }
        ),
    )
    resp = client.post("/packages", json=CREATE_BODY)
    assert resp.status_code == 422
    assert "day_number" in resp.json()["message"]
    assert resp.json()["error_code"] == "SAVE_PRECONDITION_FAILED"
    assert fake.find("GET", "travel_packages") == []


def test_create_database_failure_reports_generic_upstream_error_code(fake):
    # An unrelated UpstreamError (no error_code passed) must keep falling
    # back to UPSTREAM_ERROR — only save-precondition failures get the
    # specific code.
    fake.route("POST", "rpc/save_package_details", FakeResp({"message": "boom"}, 500))
    resp = client.post("/packages", json=CREATE_BODY)
    assert resp.status_code == 502
    assert resp.json()["error_code"] == "UPSTREAM_ERROR"


def test_get_detail(fake):
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))
    resp = client.get(f"/packages/{PKG}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["flights"][0]["origin_iata"] == "SYD"
    assert body["latest_approval"] is None
    assert body["cover_image_url"] == "https://img/1.jpg"
    assert body["pricing"] == {
        "flights_total": 1200,
        "hotels_total": 600,  # 200/night × 3 nights
        "activities_total": 90,
        "components_total": 1890,
        "base_price_aud": 2999,
    }
    call = fake.find("GET", "travel_packages")[0]
    assert call["headers"]["Authorization"] == USER_HEADERS["Authorization"]
    assert call["params"]["creator_id"] == "eq." + UID
    assert call["params"]["package_media.order"].startswith("is_cover.desc")

    fake.route("GET", "travel_packages", FakeResp([]))
    missing = client.get(f"/packages/{PKG}")
    assert missing.status_code == 404
    assert missing.json()["error_code"] == "NOT_FOUND"


# Mixed fixture: one legacy linked component per type (details IS NULL,
# catalog embed present) plus one new custom component per type (details is
# its authoritative snapshot, catalog id/embed null). Exercises both branches
# of _to_detail in a single read.
MIXED_DETAIL_ROW = {
    "package_id": PKG,
    "title": "Tokyo Week",
    "description": "Seven days of ramen.",
    "destination_country": "Japan",
    "destination_city": "Tokyo",
    "duration_days": 7,
    "base_price_aud": 2999,
    "max_group_size": 8,
    "tags": ["food"],
    "status": "draft",
    "creator_id": UID,
    "created_at": "2026-01-01T00:00:00+00:00",
    "submitted_at": None,
    "published_at": None,
    "creator": {"full_name": "Mia Tanaka", "influencer_profiles": []},
    "package_media": [{"media_id": "m1", "url": "https://img/1.jpg", "is_cover": True}],
    "package_days": [
        {"day_number": 1, "title": "Arrive", "meta": "hero", "media_ids": ["m1"]},
    ],
    "package_flights": [
        # Legacy: linked to a catalog flight row, details IS NULL.
        {
            "id": "pf-legacy",
            "flight_id": "f1",
            "day_number": None,
            "sequence_order": None,
            "notes": None,
            "details": None,
            "flights": {
                "origin": "SYD",
                "destination": "HND",
                "airline": "QF",
                "flight_number": "QF25",
                "departure_datetime": "2026-03-01T09:00:00+00:00",
                "arrival_datetime": "2026-03-01T18:00:00+00:00",
                "cabin_class": "economy",
                "price_aud": 1200,
            },
        },
        # Custom: no catalog id, details is the authoritative snapshot.
        {
            "id": "pf-custom",
            "flight_id": None,
            "day_number": 2,
            "sequence_order": 1,
            "notes": "native-projected-notes",
            "details": {
                "origin_iata": "HND",
                "destination_iata": "KIX",
                "airline": "JL",
                "flight_number": "JL123",
                "departure_datetime": "2026-03-03T09:00:00+00:00",
                "arrival_datetime": "2026-03-03T11:00:00+00:00",
                "cabin_class": "economy",
                "price_aud": 300,
                "day_number": 2,
                "sequence_order": 1,
                "notes": "custom leg",
                "media_ids": ["m1"],
                "source_id": "wizard-flight-2",
            },
            "flights": None,
        },
    ],
    "package_hotels": [
        # Legacy stay: catalog-linked, 3 nights from concrete dates.
        {
            "id": "ph-legacy",
            "hotel_id": "h1",
            "check_in_date": "2026-03-01",
            "check_out_date": "2026-03-04",
            "check_in_day": None,
            "check_out_day": None,
            "nights": 3,
            "notes": None,
            "details": None,
            "hotels": {
                "hotel_name": "Shibuya Inn",
                "star_rating": 4,
                "city": "Tokyo",
                "address": "1-1",
                "price_per_night_aud": 200,
                "room_type": "double",
            },
        },
        # Custom stay: relative days only, one stay of 2 nights (day 5 -> 7),
        # not double-counted for the checkout-boundary render.
        {
            "id": "ph-custom",
            "hotel_id": None,
            "check_in_date": None,
            "check_out_date": None,
            "check_in_day": 5,
            "check_out_day": 7,
            "nights": 2,
            "notes": "custom stay",
            "details": {
                "hotel_name": "Kyoto Ryokan",
                "star_rating": 5,
                "city": "Kyoto",
                "address": "2-2",
                "check_in_day": 5,
                "check_out_day": 7,
                "price_per_night_aud": 320,
                "room_type": "suite",
                "sequence_order": 2,
                "notes": "custom stay",
                "media_ids": [],
                "source_id": "wizard-hotel-2",
            },
            "hotels": None,
        },
    ],
    "package_activities": [
        # Legacy activity: catalog-linked, details IS NULL.
        {
            "id": "pa-legacy",
            "activity_id": "a1",
            "sequence_order": None,
            "day_number": None,
            "activity_date": "2026-03-02",
            "notes": None,
            "details": None,
            "activities": {
                "activity_name": "Ramen tour",
                "city": "Tokyo",
                "duration_hours": 3.0,
                "price_aud": 90,
                "description": "Slurp",
                "booking_required": True,
            },
        },
        # Custom activity: no catalog id, full detail fields including
        # start_time/category/address that only exist in `details`.
        {
            "id": "pa-custom",
            "activity_id": None,
            "sequence_order": 1,
            "day_number": 2,
            "activity_date": None,
            "notes": "native-projected-notes",
            "details": {
                "activity_name": "Osaka street food crawl",
                "city": "Osaka",
                "day_number": 2,
                "sequence_order": 1,
                "start_time": "18:30",
                "duration_hours": 2.5,
                "price_aud": 60,
                "category": "food",
                "address": "Dotonbori",
                "notes": "custom activity",
                "description": "Evening food crawl",
                "booking_required": False,
                "media_ids": ["m1"],
                "source_id": "wizard-activity-2",
            },
            "activities": None,
        },
    ],
}


def test_get_detail_mixed_legacy_and_custom_components(fake):
    fake.route("GET", "travel_packages", FakeResp([MIXED_DETAIL_ROW]))
    resp = client.get(f"/packages/{PKG}")
    assert resp.status_code == 200
    body = resp.json()

    legacy_flight, custom_flight = body["flights"]
    assert legacy_flight["flight_id"] == "f1"
    assert legacy_flight["package_component_id"] == "pf-legacy"
    assert legacy_flight["price_aud"] == 1200
    assert custom_flight["flight_id"] is None
    assert custom_flight["package_component_id"] == "pf-custom"
    assert custom_flight["day_number"] == 2
    assert custom_flight["sequence_order"] == 1
    assert custom_flight["notes"] == "custom leg"
    assert custom_flight["source_id"] == "wizard-flight-2"
    assert custom_flight["media_ids"] == ["m1"]
    assert custom_flight["price_aud"] == 300

    # Deterministic sort (Finding 1) now legitimately puts the custom stay
    # first: it carries an explicit sequence_order while the legacy row has
    # none, so identify each by package_component_id rather than position.
    hotels_by_id = {h["package_component_id"]: h for h in body["hotels"]}
    legacy_hotel, custom_hotel = hotels_by_id["ph-legacy"], hotels_by_id["ph-custom"]
    assert legacy_hotel["hotel_id"] == "h1"
    assert legacy_hotel["package_component_id"] == "ph-legacy"
    assert custom_hotel["hotel_id"] is None
    assert custom_hotel["package_component_id"] == "ph-custom"
    assert custom_hotel["check_in_day"] == 5
    assert custom_hotel["check_out_day"] == 7
    assert custom_hotel["address"] == "2-2"
    assert custom_hotel["notes"] == "custom stay"
    assert custom_hotel["source_id"] == "wizard-hotel-2"

    legacy_activity, custom_activity = body["activities"]
    assert legacy_activity["activity_id"] == "a1"
    assert legacy_activity["package_component_id"] == "pa-legacy"
    assert custom_activity["activity_id"] is None
    assert custom_activity["package_component_id"] == "pa-custom"
    assert custom_activity["day_number"] == 2
    assert custom_activity["start_time"] == "18:30"
    assert custom_activity["category"] == "food"
    assert custom_activity["address"] == "Dotonbori"
    assert custom_activity["notes"] == "custom activity"
    assert custom_activity["source_id"] == "wizard-activity-2"
    assert custom_activity["media_ids"] == ["m1"]

    day = body["days"][0]
    assert day["meta"] == "hero"
    assert day["media_ids"] == ["m1"]

    # Hotel totals: legacy 200×3=600, custom 320×2=640 — one stay each, the
    # checkout-boundary render is not billed as an extra night.
    assert body["pricing"]["hotels_total"] == 1240
    assert body["pricing"]["flights_total"] == 1500
    assert body["pricing"]["activities_total"] == 150


def test_get_detail_hotel_order_is_deterministic_regardless_of_row_order(fake):
    def hotel(pid, sequence_order=None, check_in_day=None):
        return {
            "id": pid,
            "hotel_id": None,
            "nights": 1,
            "details": {
                "sequence_order": sequence_order,
                "hotel_name": pid,
                "check_in_day": check_in_day,
            },
        }

    # Expected final order: h1 (seq 1), h2 (seq 2), h3 (no seq, check_in_day
    # 1), h4 (no seq, no check_in_day — falls back to package_component_id).
    ordered_ids = ["h1", "h2", "h3", "h4"]
    h1 = hotel("h1", sequence_order=1)
    h2 = hotel("h2", sequence_order=2)
    h3 = hotel("h3", check_in_day=1)
    h4 = hotel("h4")

    for shuffled in ([h4, h2, h1, h3], [h3, h4, h1, h2], list(reversed([h1, h2, h3, h4]))):
        row = copy.deepcopy(DETAIL_ROW)
        row["package_hotels"] = copy.deepcopy(shuffled)
        fake.route("GET", "travel_packages", FakeResp([row]))
        resp = client.get(f"/packages/{PKG}")
        assert resp.status_code == 200
        got_ids = [h["package_component_id"] for h in resp.json()["hotels"]]
        assert got_ids == ordered_ids, shuffled


def test_put_metadata_only_omits_collection_keys(fake):
    fake.route(
        "POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG})
    )
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))
    resp = client.put(f"/packages/{PKG}", json={"title": "New"})
    assert resp.status_code == 200

    rpc = fake.find("POST", "rpc/save_package_details")[0]
    assert rpc["headers"]["Authorization"] == "Bearer service-key"
    assert rpc["json"]["p_actor_id"] == UID
    assert rpc["json"]["p_package_id"] == PKG
    payload = rpc["json"]["p_payload"]
    assert payload == {"title": "New"}
    for key in ("flights", "hotels", "activities", "days"):
        assert key not in payload


def test_put_days_reaches_rpc_unchanged(fake):
    fake.route(
        "POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG})
    )
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))

    resp = client.put(
        f"/packages/{PKG}",
        json={
            "title": "New",
            "days": [{"day_number": 5, "title": "Arrive", "summary": "Ramen."}],
        },
    )
    assert resp.status_code == 200

    payload = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]
    assert [d["day_number"] for d in payload["days"]] == [5]
    assert payload["days"][0]["summary"] == "Ramen."


def test_put_days_null_is_no_change(fake):
    # Backward compat: explicit `days: null` must not reach the RPC as a
    # supplied collection (that would clear it) — it stays omitted.
    fake.route(
        "POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG})
    )
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))
    resp = client.put(f"/packages/{PKG}", json={"title": "New", "days": None})
    assert resp.status_code == 200
    payload = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]
    assert "days" not in payload


def test_put_empty_array_clears_collection(fake):
    fake.route(
        "POST", "rpc/save_package_details", FakeResp({"outcome": "ok", "package_id": PKG})
    )
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))
    resp = client.put(f"/packages/{PKG}", json={"flights": [], "hotels": [], "activities": []})
    assert resp.status_code == 200
    payload = fake.find("POST", "rpc/save_package_details")[0]["json"]["p_payload"]
    assert payload["flights"] == []
    assert payload["hotels"] == []
    assert payload["activities"] == []


def test_put_explicit_null_collection_rejected(fake):
    resp = client.put(f"/packages/{PKG}", json={"flights": None})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VALIDATION_ERROR"


def test_put_not_editable_and_missing(fake):
    fake.route(
        "POST",
        "rpc/save_package_details",
        FakeResp({"outcome": "not_editable", "status": "pending_review"}),
    )
    resp = client.put(f"/packages/{PKG}", json={"title": "New"})
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "PACKAGE_NOT_EDITABLE"

    fake.route("POST", "rpc/save_package_details", FakeResp({"outcome": "not_found"}))
    gone = client.put(f"/packages/{PKG}", json={"title": "New"})
    assert gone.status_code == 404
    assert gone.json()["error_code"] == "NOT_FOUND"


def test_put_database_failure_never_reports_success(fake):
    fake.route("POST", "rpc/save_package_details", FakeResp({"message": "boom"}, 500))
    resp = client.put(f"/packages/{PKG}", json={"title": "New"})
    assert resp.status_code == 502
    assert fake.find("GET", "travel_packages") == []


def test_put_precondition_failure_never_reports_success(fake):
    fake.route(
        "POST",
        "rpc/save_package_details",
        FakeResp(
            {
                "outcome": "precondition_failed",
                "details": {"failures": ["media_ids must reference photos already uploaded to this package"]},
            }
        ),
    )
    resp = client.put(f"/packages/{PKG}", json={"hotels": []})
    assert resp.status_code == 422
    assert "media_ids" in resp.json()["message"]
    assert fake.find("GET", "travel_packages") == []


def test_delete(fake):
    linked = {
        "status": "draft",
        "package_flights": [{"flight_id": "f1"}, {"flight_id": "f2"}],
        "package_hotels": [{"hotel_id": "h1"}, {"hotel_id": "h2"}],
        "package_activities": [{"activity_id": "a1"}, {"activity_id": "a2"}],
    }
    fake.route("GET", "travel_packages", FakeResp([linked]))
    fake.route("DELETE", "/rest/v1/travel_packages", FakeResp([{"package_id": PKG}]))
    fake.route("DELETE", "/rest/v1/flights", FakeResp([]))
    fake.route("DELETE", "/rest/v1/hotels", FakeResp([]))
    fake.route("DELETE", "/rest/v1/activities", FakeResp([]))

    resp = client.delete(f"/packages/{PKG}")
    assert resp.status_code == 204
    assert resp.content == b""
    assert (
        fake.find("DELETE", "/rest/v1/flights")[0]["params"]["flight_id"]
        == "in.(f1,f2)"
    )
    assert (
        fake.find("DELETE", "/rest/v1/hotels")[0]["params"]["hotel_id"] == "in.(h1,h2)"
    )
    assert (
        fake.find("DELETE", "/rest/v1/activities")[0]["params"]["activity_id"]
        == "in.(a1,a2)"
    )

    fake.route("GET", "travel_packages", FakeResp([{"status": "rejected"}]))
    blocked = client.delete(f"/packages/{PKG}")
    assert blocked.status_code == 409
    assert blocked.json()["error_code"] == "PACKAGE_NOT_DELETABLE"


def test_submit_ok(fake):
    fake.route(
        "POST",
        "rpc/submit_package_for_review",
        FakeResp({"outcome": "ok", "package_id": PKG}),
    )
    fake.route(
        "GET",
        "travel_packages",
        FakeResp(
            [
                _summary_row(
                    status="pending_review",
                    submitted_at="2026-08-12T00:00:00+00:00",
                    package_media=[
                        {"url": "https://img/1.jpg", "is_cover": True},
                        {"url": "https://img/2.jpg", "is_cover": False},
                    ],
                )
            ]
        ),
    )
    resp = client.post(f"/packages/{PKG}/submit", json={"submission_note": "ready"})
    assert resp.status_code == 200
    rpc_call = fake.find("POST", "rpc/submit_package_for_review")[0]
    assert rpc_call["json"] == {
        "p_actor_id": UID,
        "p_package_id": PKG,
        "p_note": "ready",
    }
    # Submission is derived from the authenticated bearer token via
    # service-role headers, never a client-supplied actor ID.
    assert rpc_call["headers"]["apikey"] == "service-key"
    assert resp.json()["status"] == "pending_review"
    assert resp.json()["cover_image_url"] == "https://img/1.jpg"


def test_submit_preconditions(fake):
    fake.route(
        "POST",
        "rpc/submit_package_for_review",
        FakeResp(
            {
                "outcome": "precondition_failed",
                "details": {
                    "failures": [
                        "Package must have at least one hotel.",
                        "base_price_aud must be greater than 0.",
                    ],
                    "missing": ["hotel"],
                },
            }
        ),
    )
    resp = client.post(f"/packages/{PKG}/submit")
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "SUBMISSION_PRECONDITION_FAILED"
    assert body["details"]["missing"] == ["hotel"]
    assert "price" in (body["message"] + str(body["details"])).lower()


def test_submit_pending_review_package_rejects_later_save(fake):
    """After a successful submit, a subsequent PUT save must be rejected —
    the RPCs share the same draft/rejected editable window."""
    fake.route(
        "POST",
        "rpc/submit_package_for_review",
        FakeResp({"outcome": "ok", "package_id": PKG}),
    )
    fake.route(
        "GET",
        "travel_packages",
        FakeResp([_summary_row(status="pending_review")]),
    )
    resp = client.post(f"/packages/{PKG}/submit")
    assert resp.status_code == 200

    fake.route(
        "POST",
        "rpc/save_package_details",
        FakeResp({"outcome": "not_editable", "status": "pending_review"}),
    )
    put_resp = client.put(f"/packages/{PKG}", json={"title": "New title"})
    assert put_resp.status_code == 409
    assert put_resp.json()["error_code"] == "PACKAGE_NOT_EDITABLE"


def test_submit_ownership_mismatch_returns_404(fake):
    fake.route(
        "POST",
        "rpc/submit_package_for_review",
        FakeResp({"outcome": "not_found"}),
    )
    resp = client.post(f"/packages/{PKG}/submit")
    assert resp.status_code == 404
