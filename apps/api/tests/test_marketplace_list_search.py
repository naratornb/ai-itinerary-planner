import copy
import importlib
import types

import pytest
from fastapi.testclient import TestClient

from app import core
from app.main import app
from app.marketplace import service

client = TestClient(app)

PKG = "b0000000-0000-0000-0000-000000000001"
PKG2 = "b0000000-0000-0000-0000-000000000002"
UID = "u0000000-0000-0000-0000-000000000001"


class FakeResp:
    def __init__(self, payload, status_code=200, headers=None):
        self._payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.headers = headers or {}
        self.text = str(payload)

    def json(self):
        # Fresh copy per call, like real Response.json() re-parsing the body.
        return copy.deepcopy(self._payload)


class FakeRequestException(Exception):
    """Stand-in for requests.RequestException — must NOT be bare Exception."""


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

    def find(self, method, substr):
        return [c for c in self.calls if c["method"] == method and substr in c["url"]]


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(core, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    fr = FakeRequests()
    stub = types.SimpleNamespace(
        get=fr.get, post=fr.post, RequestException=FakeRequestException
    )
    monkeypatch.setattr(service, "requests", stub)
    # The router may re-export requests / config constants; patch if it does.
    try:
        router = importlib.import_module("app.marketplace.router")
    except ModuleNotFoundError:
        router = None
    if router is not None:
        for name, value in (
            ("requests", stub),
            ("SUPABASE_URL", "https://example.supabase.co"),
            ("SUPABASE_ANON_KEY", "anon-key"),
        ):
            if hasattr(router, name):
                monkeypatch.setattr(router, name, value)
    yield fr
    assert not fr.queue, f"unconsumed routes: {fr.queue}"


LIST_ROW = {
    "package_id": PKG,
    "title": "Tokyo Week",
    "destination_country": "Japan",
    "destination_city": "Tokyo",
    "duration_days": 7,
    "base_price_aud": 3890,
    "tags": ["food", "culture"],
    "published_at": "2026-01-01T00:00:00+00:00",
    "creator": {
        "full_name": "Mia",
        "influencer_profiles": [
            {"instagram_handle": "@mia", "follower_count": 482000}
        ],
    },
    "package_media": [{"url": "https://img/1.jpg", "is_cover": True, "sort_order": 0}],
}

RPC_ROW = {
    "package_id": PKG,
    "title": "Tokyo Week",
    "destination_country": "Japan",
    "destination_city": "Tokyo",
    "duration_days": 7,
    "base_price_aud": 3890,
    "tags": ["food"],
    "published_at": "2026-01-01T00:00:00+00:00",
    "creator_id": UID,
    "relevance_score": 0.847,
    "total_count": 1,
}


def test_list_live_packages(fake):
    fake.route(
        "GET",
        "travel_packages",
        FakeResp([LIST_ROW], headers={"Content-Range": "0-0/1"}),
    )
    resp = client.get("/marketplace/packages")
    assert resp.status_code == 200
    body = resp.json()
    item = body["data"][0]
    assert item["cover_image_url"] == "https://img/1.jpg"
    assert item["influencer"]["display_name"] == "Mia"
    assert item["influencer"]["instagram_handle"] == "@mia"
    assert item["tags"] == ["food", "culture"]
    assert item["base_price_aud"] == 3890  # whole dollars, no cents conversion
    assert body["meta"]["total"] == 1

    call = fake.find("GET", "travel_packages")[0]
    params = call["params"]
    assert params["status"] == "eq.live"
    assert params["order"] == "published_at.desc"
    assert "limit" in params and "offset" in params
    assert call["headers"]["Prefer"] == "count=exact"
    # Public endpoint: anon key only, never a user token.
    assert call["headers"]["apikey"] == "anon-key"


@pytest.mark.parametrize(
    "sort,order",
    [
        ("price_asc", "base_price_aud.asc"),
        ("price_desc", "base_price_aud.desc"),
        ("duration_asc", "duration_days.asc"),
    ],
)
def test_list_filters_and_sort(fake, sort, order):
    fake.route("GET", "travel_packages", FakeResp([], headers={"Content-Range": "*/0"}))
    resp = client.get(
        "/marketplace/packages?destination_country=japan&min_price_aud=1000"
        f"&max_price_aud=5000&min_nights=5&max_nights=10&tags=food,beach&sort={sort}"
    )
    assert resp.status_code == 200
    assert resp.json()["data"] == []

    call = fake.find("GET", "travel_packages")[0]
    s = str(call["params"])
    assert "ilike.*japan*" in s
    # PostgREST repeated keys: accept dict-of-list or list-of-tuples encoding.
    assert "gte.1000" in s and "lte.5000" in s
    assert "gte.5" in s and "lte.10" in s
    assert "ov.{food,beach}" in s
    assert order in s


def test_search_ranked_results(fake):
    row2 = dict(LIST_ROW, package_id=PKG2, title="Bali Reset")
    rpc2 = dict(RPC_ROW, package_id=PKG2, relevance_score=0.2, total_count=2)
    fake.route(
        "POST", "rpc/search_packages", FakeResp([dict(RPC_ROW, total_count=2), rpc2])
    )
    # Embed fetch returns rows in a DIFFERENT order: RPC ranking must win.
    fake.route("GET", "travel_packages", FakeResp([row2, LIST_ROW]))

    resp = client.get("/marketplace/search?q=Bali surfing")
    assert resp.status_code == 200
    body = resp.json()
    assert body["query"] == "Bali surfing"
    assert [i["package_id"] for i in body["data"]] == [PKG, PKG2]
    item = body["data"][0]
    assert item["relevance_score"] == 0.847
    assert item["influencer"]["display_name"] == "Mia"
    assert item["cover_image_url"] == "https://img/1.jpg"
    assert body["meta"]["total"] == 2

    rpc = fake.find("POST", "rpc/search_packages")[0]
    assert rpc["json"]["q"] == "Bali surfing"
    assert rpc["json"]["page"] == 1
    assert rpc["json"]["per_page"] == 20
    assert rpc["headers"]["apikey"] == "anon-key"

    embed = fake.find("GET", "travel_packages")[0]
    assert PKG in str(embed["params"])


def test_search_query_length_bounds(fake):
    resp = client.get("/marketplace/search?q=x")
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "SEARCH_QUERY_TOO_SHORT"
    assert client.get("/marketplace/search?q=" + "a" * 201).status_code == 400
    assert fake.calls == []
    # Exactly 2 chars is valid.
    fake.route("POST", "rpc/search_packages", FakeResp([]))
    assert client.get("/marketplace/search?q=ab").status_code == 200


def test_search_empty_results(fake):
    # No follow-up GET is routed: an empty RPC result must not trigger one.
    fake.route("POST", "rpc/search_packages", FakeResp([]))
    resp = client.get("/marketplace/search?q=nothingmatches")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"] == []
    assert body["meta"]["total"] == 0
    assert fake.find("GET", "travel_packages") == []


def test_search_with_filters(fake):
    fake.route("POST", "rpc/search_packages", FakeResp([]))
    resp = client.get(
        "/marketplace/search?q=bali&destination_country=Indonesia"
        "&min_price_aud=100&max_price_aud=900&tags=surf,beach"
    )
    assert resp.status_code == 200
    payload = fake.find("POST", "rpc/search_packages")[0]["json"]
    assert payload["dest_country"] == "Indonesia"
    assert payload["min_price"] == 100
    assert payload["max_price"] == 900
    assert payload["filter_tags"] == ["surf", "beach"]
