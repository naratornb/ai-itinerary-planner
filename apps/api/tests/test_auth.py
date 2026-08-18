import types

import pytest
from fastapi.testclient import TestClient

from app import core
from app.auth import router as auth_router
from app.main import app

client = TestClient(app)

UID = "u0000000-0000-0000-0000-000000000001"
URL = "https://sb.test"
BEARER = {"Authorization": "Bearer tok"}

AUTH_USER = {
    "id": UID,
    "email": "e@x.com",
    "created_at": "2026-01-01T00:00:00Z",
}

TOKEN_OK = {
    "access_token": "tok",
    "expires_in": 3600,
    "user": AUTH_USER,
}


def _profile_row(role="influencer", influencer=True):
    return {
        "full_name": "Luke",
        "role": role,
        "created_at": "2026-01-01T00:00:00Z",
        "influencer_profiles": (
            [
                {
                    "bio": "b",
                    "instagram_handle": "@l",
                    "tiktok_handle": None,
                    "follower_count": 10,
                    "verified": False,
                }
            ]
            if influencer
            else []
        ),
    }


class FakeResp:
    def __init__(self, payload=None, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.headers = {}
        self.text = str(payload)

    def json(self):
        return self._payload


class FakeRequestException(Exception):
    """Not a bare Exception, or `except requests.RequestException` eats it."""


class FakeRequests:
    """Queue of (method, url_substring, response), first match wins."""

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


def _configure(monkeypatch, fr):
    """Patch config + requests on both core and the router module.

    The router may read config as `core.X` or may have imported the names
    directly; patch whichever exists so the tests hold either way.
    """
    fake = types.SimpleNamespace(
        get=fr.get, post=fr.post, RequestException=FakeRequestException
    )
    values = {
        "SUPABASE_URL": URL,
        "SUPABASE_ANON_KEY": "anon",
        "SUPABASE_SERVICE_ROLE_KEY": "svc",
    }
    for mod in (core, auth_router):
        for name, value in values.items():
            if hasattr(mod, name):
                monkeypatch.setattr(mod, name, value)
        if hasattr(mod, "requests"):
            monkeypatch.setattr(mod, "requests", fake)


@pytest.fixture
def fake(monkeypatch):
    fr = FakeRequests()
    _configure(monkeypatch, fr)
    yield fr
    app.dependency_overrides.clear()


def _override_user():
    app.dependency_overrides[core.require_user] = lambda: dict(AUTH_USER)
    app.dependency_overrides[core.require_user_ctx] = lambda: {
        "uid": UID,
        "headers": {"apikey": "anon", "Authorization": "Bearer tok"},
    }


def test_login_success(fake):
    fake.route("POST", "/auth/v1/token", FakeResp(TOKEN_OK))
    fake.route("GET", "/rest/v1/profiles", FakeResp([_profile_row()]))

    resp = client.post("/auth/login", json={"email": "e@x.com", "password": "password1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] == "tok"
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 3600
    assert body["user"]["display_name"] == "Luke"
    assert body["user"]["role"] == "influencer"
    assert body["user"]["influencer_profile"]["instagram_handle"] == "@l"

    token_call = fake.find("POST", "/auth/v1/token")[0]
    assert "grant_type=password" in token_call["url"] or token_call["params"].get(
        "grant_type"
    ) == "password"


def test_login_invalid_credentials(fake):
    fake.route("POST", "/auth/v1/token", FakeResp({"error": "bad"}, 400))
    resp = client.post("/auth/login", json={"email": "e@x.com", "password": "password1"})
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "INVALID_CREDENTIALS"


def test_login_short_password(fake):
    resp = client.post("/auth/login", json={"email": "e@x.com", "password": "short"})
    assert resp.status_code == 422


def test_me_customer_has_no_influencer_profile(fake):
    _override_user()
    fake.route("GET", "/auth/v1/user", FakeResp(AUTH_USER))
    fake.route(
        "GET",
        "/rest/v1/profiles",
        # Embed populated but role is customer: only the role gate can null it.
        FakeResp([_profile_row(role="customer", influencer=True)]),
    )

    resp = client.get("/auth/me", headers=BEARER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "Luke"
    assert body["role"] == "customer"
    assert body["influencer_profile"] is None


def test_me_requires_token(fake):
    assert core.require_user not in app.dependency_overrides
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_logout(fake):
    _override_user()
    fake.route("GET", "/auth/v1/user", FakeResp(AUTH_USER))
    fake.route("POST", "/auth/v1/logout", FakeResp(None, 204))

    resp = client.post("/auth/logout", headers=BEARER)
    assert resp.status_code == 204
    assert resp.content == b""
    assert fake.find("POST", "/auth/v1/logout")


def test_logout_invalid_token(fake):
    _override_user()
    fake.route("POST", "/auth/v1/logout", FakeResp({"msg": "bad"}, 401))
    resp = client.post("/auth/logout", headers=BEARER)
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "UNAUTHORIZED"


def test_logout_requires_token(fake):
    assert core.require_user not in app.dependency_overrides
    resp = client.post("/auth/logout")
    assert resp.status_code == 401
