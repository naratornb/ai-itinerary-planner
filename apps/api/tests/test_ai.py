import copy
import types

import pytest
from fastapi.testclient import TestClient

from app import core
from app.ai import service as ai_service
from app.main import app
from app.packages import service as packages_service

client = TestClient(app)

UID = "u0000000-0000-0000-0000-000000000001"
PKG = "b0000000-0000-0000-0000-000000000001"
SID = "50000000-0000-0000-0000-000000000001"
USER_HEADERS = {"apikey": "anon-key", "Authorization": "Bearer user-token"}
PROMPT = "Ten days of surfing please"


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
    ns = types.SimpleNamespace(
        get=fr.get,
        post=fr.post,
        patch=fr.patch,
        delete=fr.delete,
        RequestException=FakeRequestException,
    )
    # accept(auto_apply=True) reaches into packages.service for the detail embed.
    monkeypatch.setattr(ai_service, "requests", ns)
    monkeypatch.setattr(packages_service, "requests", ns)
    app.dependency_overrides[core.require_user_ctx] = lambda: {
        "uid": UID,
        "headers": dict(USER_HEADERS),
    }
    yield fr
    app.dependency_overrides.clear()
    assert not fr.queue


SUGGESTION_ROW = {
    "suggestion_id": SID,
    "package_id": PKG,
    "prompt": PROMPT,
    "suggestion_text": "# Suggested itinerary...",
    "status": "pending",
    "generated_at": "2026-01-01T00:00:00+00:00",
    "accepted_at": None,
    "response_time_ms": 5,
}

PKG_ROW = {
    "package_id": PKG,
    "title": "Tokyo Week",
    "destination_city": "Tokyo",
    "destination_country": "Japan",
    "duration_days": 7,
}


def test_suggest_creates_pending_row(fake):
    fake.route("GET", "travel_packages", FakeResp([PKG_ROW]))
    fake.route("POST", "ai_suggestions", FakeResp([SUGGESTION_ROW]))

    resp = client.post("/ai/suggest", json={"package_id": PKG, "prompt": PROMPT})
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "pending"
    assert body["suggestion_id"] == SID

    posted = fake.find("POST", "ai_suggestions")[0]["json"]
    assert posted["prompt"] == PROMPT
    assert posted["status"] == "pending"
    assert posted["package_id"] == PKG
    assert isinstance(posted["suggestion_text"], str) and posted["suggestion_text"]
    assert isinstance(posted["response_time_ms"], int)
    assert posted["response_time_ms"] >= 0


def test_suggest_prompt_out_of_bounds(fake):
    resp = client.post("/ai/suggest", json={"package_id": PKG, "prompt": "short"})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VALIDATION_ERROR"
    long = client.post("/ai/suggest", json={"package_id": PKG, "prompt": "x" * 1001})
    assert long.status_code == 422
    assert fake.calls == []


def test_suggest_unknown_package(fake):
    fake.route("GET", "travel_packages", FakeResp([]))
    resp = client.post("/ai/suggest", json={"package_id": PKG, "prompt": PROMPT})
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"


def test_list_suggestions_filters_and_pages(fake):
    fake.route("GET", "travel_packages", FakeResp([{"package_id": PKG}]))
    fake.route(
        "GET",
        "ai_suggestions",
        FakeResp([SUGGESTION_ROW], headers={"Content-Range": "5-5/6"}),
    )

    resp = client.get(f"/ai/suggestions/{PKG}?status=accepted&page=2&per_page=5")
    assert resp.status_code == 200
    meta = resp.json()["meta"]
    assert meta["total"] == 6
    assert meta["page"] == 2

    params = fake.find("GET", "ai_suggestions")[0]["params"]
    assert params["status"] == "eq.accepted"
    assert "generated_at.desc" in params["order"]
    assert int(params["offset"]) == 5
    assert int(params["limit"]) == 5


def test_list_suggestions_unknown_package(fake):
    fake.route("GET", "travel_packages", FakeResp([]))
    resp = client.get(f"/ai/suggestions/{PKG}")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"


# ponytail: auto_apply=True's package-detail embed is untested here — it drags
# the whole packages detail fixture in. Cover it in test_packages if it breaks.
def test_accept_without_auto_apply(fake):
    fake.route("GET", "ai_suggestions", FakeResp([SUGGESTION_ROW]))
    fake.route(
        "PATCH",
        "ai_suggestions",
        FakeResp(
            [
                dict(
                    SUGGESTION_ROW,
                    status="accepted",
                    accepted_at="2026-01-02T00:00:00+00:00",
                )
            ]
        ),
    )

    resp = client.patch(f"/ai/suggestions/{SID}/accept", json={"auto_apply": False})
    assert resp.status_code == 200
    body = resp.json()
    assert body["suggestion"]["status"] == "accepted"
    assert body.get("package") is None

    patch = fake.find("PATCH", "ai_suggestions")[0]
    assert "eq.pending" in patch["params"].values()
    assert patch["json"]["accepted_at"]


def test_accept_loses_race(fake):
    fake.route("GET", "ai_suggestions", FakeResp([SUGGESTION_ROW]))
    fake.route("PATCH", "ai_suggestions", FakeResp([]))
    fake.route("GET", "ai_suggestions", FakeResp([dict(SUGGESTION_ROW, status="dismissed")]))
    resp = client.patch(f"/ai/suggestions/{SID}/accept", json={"auto_apply": False})
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "SUGGESTION_ALREADY_RESOLVED"


def test_accept_already_resolved(fake):
    fake.route("GET", "ai_suggestions", FakeResp([dict(SUGGESTION_ROW, status="dismissed")]))
    resp = client.patch(f"/ai/suggestions/{SID}/accept", json={"auto_apply": False})
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "SUGGESTION_ALREADY_RESOLVED"
    assert fake.find("PATCH", "ai_suggestions") == []


def test_accept_unknown_suggestion(fake):
    fake.route("GET", "ai_suggestions", FakeResp([]))
    resp = client.patch(f"/ai/suggestions/{SID}/accept", json={"auto_apply": False})
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"


def test_dismiss(fake):
    fake.route("GET", "ai_suggestions", FakeResp([SUGGESTION_ROW]))
    fake.route(
        "PATCH", "ai_suggestions", FakeResp([dict(SUGGESTION_ROW, status="dismissed")])
    )
    resp = client.patch(f"/ai/suggestions/{SID}/dismiss")
    assert resp.status_code == 200
    assert resp.json()["status"] == "dismissed"
    assert "accepted_at" not in fake.find("PATCH", "ai_suggestions")[0]["json"]


def test_suggest_unauthorized(monkeypatch):
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(core, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    assert core.require_user_ctx not in app.dependency_overrides
    resp = client.post("/ai/suggest", json={"package_id": PKG, "prompt": PROMPT})
    assert resp.status_code == 401
