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


def test_create_maps_inputs(fake):
    fake.route("POST", "/rest/v1/travel_packages", FakeResp([{"package_id": PKG}]))
    fake.route(
        "POST", "/rest/v1/flights", FakeResp([{"flight_id": "f1"}, {"flight_id": "f2"}])
    )
    fake.route(
        "POST", "/rest/v1/hotels", FakeResp([{"hotel_id": "h1"}, {"hotel_id": "h2"}])
    )
    fake.route(
        "POST",
        "/rest/v1/activities",
        FakeResp([{"activity_id": "a1"}, {"activity_id": "a2"}]),
    )
    fake.route("POST", "package_flights", FakeResp([{}]))
    fake.route("POST", "package_hotels", FakeResp([{}]))
    fake.route("POST", "package_activities", FakeResp([{}]))
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))

    resp = client.post("/packages", json=CREATE_BODY)
    assert resp.status_code == 201

    flight_post = fake.find("POST", "/rest/v1/flights")[0]
    assert flight_post["headers"]["Authorization"] == "Bearer service-key"
    assert flight_post["json"][0]["origin"] == "SYD"

    pkg_post = fake.find("POST", "/rest/v1/travel_packages")[0]
    assert pkg_post["headers"]["Authorization"] == USER_HEADERS["Authorization"]
    assert pkg_post["json"]["creator_id"] == UID

    junction = fake.find("POST", "package_flights")[0]
    assert junction["headers"]["Authorization"] == USER_HEADERS["Authorization"]
    assert junction["json"][0]["sequence_order"] == 1
    assert junction["json"][1]["sequence_order"] == 2

    hotels = fake.find("POST", "package_hotels")[0]["json"]
    assert hotels[0]["nights"] == 3
    assert hotels[0]["check_in_date"] == "2026-03-01"
    assert hotels[0]["check_out_date"] == "2026-03-04"
    assert hotels[1]["nights"] == 4  # 2026-03-04 -> 2026-03-08

    acts = fake.find("POST", "package_activities")[0]["json"]
    assert acts[1]["sequence_order"] == 2
    assert acts[1]["activity_date"] == "2026-03-05"

    assert resp.json()["flights"][0]["origin_iata"] == "SYD"


def test_create_missing_required(fake):
    body = {k: v for k, v in CREATE_BODY.items() if k != "title"}
    resp = client.post("/packages", json=body)
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VALIDATION_ERROR"


def test_create_midflight_failure(fake):
    # Package row first, catalog next, junctions last — the junction POST blows
    # up, so the rollback must undo both the package and the catalog rows.
    fake.route("POST", "/rest/v1/travel_packages", FakeResp([{"package_id": PKG}]))
    fake.route(
        "POST", "/rest/v1/flights", FakeResp([{"flight_id": "f1"}, {"flight_id": "f2"}])
    )
    fake.route(
        "POST", "/rest/v1/hotels", FakeResp([{"hotel_id": "h1"}, {"hotel_id": "h2"}])
    )
    fake.route(
        "POST",
        "/rest/v1/activities",
        FakeResp([{"activity_id": "a1"}, {"activity_id": "a2"}]),
    )
    fake.route("POST", "package_flights", FakeResp({"message": "boom"}, 500))
    fake.route("DELETE", "/rest/v1/travel_packages", FakeResp([{}]))
    fake.route("DELETE", "/rest/v1/flights", FakeResp([{}]))
    fake.route("DELETE", "/rest/v1/hotels", FakeResp([{}]))
    fake.route("DELETE", "/rest/v1/activities", FakeResp([{}]))

    resp = client.post("/packages", json=CREATE_BODY)
    assert resp.status_code == 502
    assert resp.json()["message"] == "Upstream database error."
    rollback = fake.find("DELETE", "travel_packages")
    assert rollback and rollback[0]["params"]["package_id"] == f"eq.{PKG}"


def test_get_detail(fake):
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))
    resp = client.get(f"/packages/{PKG}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["flights"][0]["origin_iata"] == "SYD"
    assert body["latest_approval"] is None
    assert body["cover_image_url"] == "https://img/1.jpg"
    call = fake.find("GET", "travel_packages")[0]
    assert call["headers"]["Authorization"] == USER_HEADERS["Authorization"]
    assert call["params"]["creator_id"] == "eq." + UID
    assert call["params"]["package_media.order"].startswith("is_cover.desc")

    fake.route("GET", "travel_packages", FakeResp([]))
    missing = client.get(f"/packages/{PKG}")
    assert missing.status_code == 404
    assert missing.json()["error_code"] == "NOT_FOUND"


def test_put_draft_ok(fake):
    fake.route("PATCH", "travel_packages", FakeResp([{"package_id": PKG}]))
    fake.route("GET", "travel_packages", FakeResp([DETAIL_ROW]))
    resp = client.put(f"/packages/{PKG}", json={"title": "New"})
    assert resp.status_code == 200
    patch = fake.find("PATCH", "travel_packages")[0]
    assert set(patch["json"]) == {"title", "updated_at"}
    assert patch["params"]["status"] == "in.(draft,rejected)"


def test_put_not_editable_and_missing(fake):
    fake.route("PATCH", "travel_packages", FakeResp([]))
    fake.route("GET", "travel_packages", FakeResp([{"status": "pending_review"}]))
    resp = client.put(f"/packages/{PKG}", json={"title": "New"})
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "PACKAGE_NOT_EDITABLE"

    fake.route("PATCH", "travel_packages", FakeResp([]))
    fake.route("GET", "travel_packages", FakeResp([]))
    gone = client.put(f"/packages/{PKG}", json={"title": "New"})
    assert gone.status_code == 404
    assert gone.json()["error_code"] == "NOT_FOUND"


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
    ready = {
        "package_id": PKG,
        "status": "draft",
        "base_price_aud": 2999,
        "package_flights": [{"flight_id": "f1"}],
        "package_hotels": [{"hotel_id": "h1"}],
        "package_activities": [{"activity_id": "a1"}],
    }
    fake.route("GET", "travel_packages", FakeResp([ready]))
    fake.route(
        "PATCH",
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
    patch = fake.find("PATCH", "travel_packages")[0]
    assert patch["json"]["status"] == "pending_review"
    assert patch["json"]["submitted_at"]
    assert patch["json"]["submission_note"] == "ready"
    assert patch["params"]["status"] == "in.(draft,rejected)"
    assert resp.json()["status"] == "pending_review"
    assert resp.json()["cover_image_url"] == "https://img/1.jpg"


def test_submit_preconditions(fake):
    bad = {
        "package_id": PKG,
        "status": "draft",
        "base_price_aud": 0,
        "package_flights": [{"flight_id": "f1"}],
        "package_hotels": [],
        "package_activities": [{"activity_id": "a1"}],
    }
    fake.route("GET", "travel_packages", FakeResp([bad]))
    resp = client.post(f"/packages/{PKG}/submit")
    assert resp.status_code == 422
    body = resp.json()
    assert body["error_code"] == "SUBMISSION_PRECONDITION_FAILED"
    assert body["details"]["missing"] == ["hotel"]
    assert "price" in (body["message"] + str(body["details"])).lower()
