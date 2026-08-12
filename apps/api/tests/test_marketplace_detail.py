import yaml
from fastapi.testclient import TestClient

from app import core as app_core
from app.main import app
from app.marketplace import router as marketplace_router

client = TestClient(app)


class FakeResp:
    def __init__(self, payload):
        self.ok = True
        self.status_code = 200
        self._payload = payload

    def json(self):
        return self._payload


FIXTURE = {
    "package_id": "b0000000-0000-0000-0000-000000000001",
    "title": "Tokyo Street Food & Culture Week",
    "base_price_aud": 2999,
    "tags": ["food", "culture"],
    "max_group_size": 8,
    "creator": {"full_name": "Mia Tanaka", "influencer_profiles": []},
    "package_media": [{"media_id": "m1", "is_cover": True, "sort_order": 1}],
    "package_days": [{"day_number": 1, "title": "Arrive in Tokyo"}],
    "package_flights": [],
    "package_hotels": [],
    "package_activities": [],
}


def _fake_get(payload, calls):
    def fake(url, params=None, headers=None, timeout=None):
        calls.append({"url": url, "params": params or {}})
        return FakeResp(payload)

    return fake


def _configure(monkeypatch):
    monkeypatch.setattr(app_core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(app_core, "SUPABASE_ANON_KEY", "anon-key")


def test_404_when_not_visible(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(marketplace_router.requests, "get", _fake_get([], []))
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000008")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "PACKAGE_NOT_FOUND"


def test_detail_passthrough_and_query(monkeypatch):
    _configure(monkeypatch)
    calls = []
    monkeypatch.setattr(marketplace_router.requests, "get", _fake_get([FIXTURE], calls))
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000001")
    assert resp.status_code == 200
    body = resp.json()
    # PostgREST child keys are renamed to the contract's names
    assert body["days"] == [{"day_number": 1, "title": "Arrive in Tokyo"}]
    assert body["media"][0]["is_cover"] is True
    for key in ("flights", "hotels", "activities"):
        assert body[key] == []
    assert "package_media" not in body
    # Ordering lives in the query string — regressions happen there
    params = calls[0]["params"]
    assert "package_days(*)" in params["select"]
    assert "influencer_profiles" in params["select"]
    assert params["package_media.order"] == "is_cover.desc,sort_order.asc"
    assert params["package_flights.order"] == "day_number.asc,sequence_order.asc"


def test_price_whole_dollars(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(marketplace_router.requests, "get", _fake_get([FIXTURE], []))
    resp = client.get("/marketplace/packages/b0000000-0000-0000-0000-000000000001")
    assert resp.json()["base_price_aud"] == 2999  # no cents conversion, ever


def test_openapi_yaml_served_and_valid():
    resp = client.get("/openapi.yaml")
    assert resp.status_code == 200
    doc = yaml.safe_load(resp.text)
    assert doc["openapi"].startswith("3.")
    assert "/marketplace/packages/{package_id}" in doc["paths"]
    assert "PackageDay" in doc["components"]["schemas"]
