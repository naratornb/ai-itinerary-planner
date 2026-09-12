import yaml
from fastapi.testclient import TestClient

from app import core as app_core
from app.main import app
from app.packages import service as packages_service

client = TestClient(app)


class FakeResp:
    def __init__(self, payload, ok=True, status_code=200, text=""):
        self.ok = ok
        self.status_code = status_code
        self.text = text
        self._payload = payload

    def json(self):
        return self._payload


FIXTURE = {
    "package_id": "b0000000-0000-0000-0000-000000000001",
    "title": "Tokyo Street Food & Culture Week",
    "description": "A week of street food and culture.",
    "destination_country": "Japan",
    "destination_city": "Tokyo",
    "duration_days": 7,
    "base_price_aud": 2999,
    "status": "live",
    "creator_id": "c0000000-0000-0000-0000-000000000001",
    "created_at": "2026-01-01T00:00:00+00:00",
    "tags": ["food", "culture"],
    "max_group_size": 8,
    # Private/internal columns that select=* drags along; response_model must
    # strip them from the public payload.
    "submission_note": "please approve quickly",
    "search_tsv": "'tokyo':1 'food':2",
    "creator": {"full_name": "Mia Tanaka", "influencer_profiles": []},
    "package_media": [{"media_id": "m1", "url": "https://x/m1.jpg", "is_cover": True, "sort_order": 1}],
    "package_days": [{"day_number": 1, "title": "Arrive in Tokyo"}],
    "package_flights": [{"flight_id": "f1", "sequence_order": 1, "flights": {"price_aud": 900}}],
    "package_hotels": [
        {"hotel_id": "h1", "nights": 3, "hotels": {"hotel_name": "Shinjuku Inn", "price_per_night_aud": 200}},
        {"hotel_id": "h2", "nights": 2, "hotels": {"hotel_name": "No Price Inn", "price_per_night_aud": None}},
        {"hotel_id": "h3", "nights": None, "hotels": {"hotel_name": "No Nights Inn", "price_per_night_aud": 500}},
    ],
    "package_activities": [
        {"activity_id": "a1", "sequence_order": 1, "activities": {"activity_name": "Food tour", "price_aud": 150}},
        {"activity_id": "a2", "sequence_order": 2, "activities": {"activity_name": "Free walk", "price_aud": None}},
    ],
}


def _fake_get(payload, calls):
    def fake(url, params=None, headers=None, timeout=None):
        calls.append({"url": url, "params": params or {}, "headers": headers or {}})
        return FakeResp(payload)

    return fake


def _configure(monkeypatch):
    monkeypatch.setattr(app_core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(app_core, "SUPABASE_ANON_KEY", "anon-key")


def test_404_when_not_visible(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(packages_service.requests, "get", _fake_get([], []))
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000008")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "PACKAGE_NOT_FOUND"


def test_upstream_error_not_leaked(monkeypatch):
    _configure(monkeypatch)

    def fake(url, params=None, headers=None, timeout=None):
        return FakeResp(None, ok=False, status_code=500, text="secret pg detail")

    monkeypatch.setattr(packages_service.requests, "get", fake)
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000001")
    assert resp.status_code == 502
    assert resp.json()["error_code"] == "UPSTREAM_ERROR"
    assert "secret pg detail" not in resp.text


def test_detail_flattened_shape_and_query(monkeypatch):
    _configure(monkeypatch)
    calls = []
    monkeypatch.setattr(
        packages_service.requests, "get",
        _fake_get([dict(FIXTURE)], calls),
    )
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000001")
    assert resp.status_code == 200
    body = resp.json()
    # Same flattened TravelPackageDetail shape as the owner endpoint
    assert body["days"][0]["day_number"] == 1
    assert body["media"][0]["is_cover"] is True
    assert body["cover_image_url"] == "https://x/m1.jpg"
    assert body["flights"][0]["price_aud"] == 900
    assert body["hotels"][0]["hotel_name"] == "Shinjuku Inn"
    assert body["activities"][1]["price_aud"] is None
    assert body["latest_approval"] is None
    assert "package_media" not in body
    # Internal columns must never reach the public payload
    assert "submission_note" not in body
    assert "search_tsv" not in body
    # Draft-hiding hinges on calling PostgREST with the anon key (RLS)
    assert calls[0]["headers"] == {
        "apikey": "anon-key",
        "Authorization": "Bearer anon-key",
    }
    # Ordering lives in the query string — regressions happen there
    params = calls[0]["params"]
    assert "package_days(*)" in params["select"]
    assert "influencer_profiles" in params["select"]
    assert params["package_media.order"] == "is_cover.desc,sort_order.asc"
    assert params["package_flights.order"] == "day_number.asc,sequence_order.asc"


def test_pricing_breakdown(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(
        packages_service.requests, "get", _fake_get([dict(FIXTURE)], [])
    )
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000001")
    pricing = resp.json()["pricing"]
    assert pricing == {
        "flights_total": 900,
        # 200×3; null-priced and null-nights hotels each count as 0
        "hotels_total": 600,
        "activities_total": 150,
        "components_total": 1650,
        "base_price_aud": 2999,
    }


def test_legacy_null_columns_still_serve(monkeypatch):
    # Pre-0006 rows (and PUT {"description": null}) leave nullable columns —
    # the public endpoint must not 500 on them.
    _configure(monkeypatch)
    row = dict(FIXTURE)
    row.update(description=None, destination_city=None, duration_days=None)
    monkeypatch.setattr(packages_service.requests, "get", _fake_get([row], []))
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000001")
    assert resp.status_code == 200
    assert resp.json()["description"] is None


def test_price_whole_dollars(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(
        packages_service.requests, "get", _fake_get([dict(FIXTURE)], [])
    )
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000001")
    assert resp.json()["base_price_aud"] == 2999  # no cents conversion, ever


def test_openapi_yaml_served_and_valid():
    resp = client.get("/openapi.yaml")
    assert resp.status_code == 200
    doc = yaml.safe_load(resp.text)
    assert doc["openapi"].startswith("3.")
    assert "/marketplace/packages/{package_id}" in doc["paths"]
    assert "PackageDay" in doc["components"]["schemas"]
    for path in ("/packages", "/packages/{package_id}", "/packages/{package_id}/submit"):
        assert path in doc["paths"]
    for schema in ("TravelPackageCreate", "TravelPackageUpdate", "TravelPackageDetail"):
        assert schema in doc["components"]["schemas"]
