import copy
import types

import pytest
from fastapi.testclient import TestClient

from app import core
from app.approvals import service
from app.main import app

client = TestClient(app)

UID = "a0000000-0000-0000-0000-000000000001"
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


CTX = {"uid": UID, "headers": dict(USER_HEADERS)}


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
    app.dependency_overrides[core.require_admin_ctx] = lambda: dict(CTX)
    app.dependency_overrides[core.require_user_ctx] = lambda: dict(CTX)
    yield fr
    app.dependency_overrides.clear()


def _summary_row(**over):
    row = {
        "package_id": PKG,
        "title": "Tokyo Week",
        "destination_country": "Japan",
        "destination_city": "Tokyo",
        "duration_days": 7,
        "base_price_aud": 2999,
        "status": "pending_review",
        "creator_id": UID,
        "created_at": "2026-01-01T00:00:00+00:00",
        "submitted_at": "2026-01-02T00:00:00+00:00",
        "published_at": None,
    }
    row.update(over)
    return row


APPROVAL_ROW = {
    "approval_id": "c0000000-0000-0000-0000-000000000001",
    "package_id": PKG,
    "reviewer_id": UID,
    "decision": "approved",
    "rejection_reason": None,
    "reviewed_at": "2026-01-01T00:00:00+00:00",
}


def test_list_pending_defaults(fake):
    row = _summary_row()
    row["package_media"] = [{"url": "https://img/1.jpg", "is_cover": True}]
    fake.route(
        "GET", "travel_packages", FakeResp([row], headers={"Content-Range": "0-0/1"})
    )
    resp = client.get("/approvals")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"][0]["package_id"] == PKG
    assert body["meta"]["total"] == 1
    params = fake.find("GET", "travel_packages")[0]["params"]
    assert "pending_review" in params["status"]
    assert params["order"] == "submitted_at.asc"


def test_list_pending_sort_desc(fake):
    fake.route("GET", "travel_packages", FakeResp([], headers={"Content-Range": "*/0"}))
    resp = client.get("/approvals?sort=submitted_at_desc")
    assert resp.status_code == 200
    assert fake.find("GET", "travel_packages")[0]["params"]["order"] == (
        "submitted_at.desc"
    )


def test_list_pending_unauthorized(monkeypatch):
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(core, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    assert core.require_admin_ctx not in app.dependency_overrides
    unauth = client.get("/approvals")
    assert unauth.status_code == 401
    assert unauth.json()["error_code"] == "UNAUTHORIZED"


def test_approve_ok(fake):
    fake.route("GET", "travel_packages", FakeResp([_summary_row()]))
    fake.route("PATCH", "travel_packages", FakeResp([_summary_row(status="approved")]))
    fake.route("POST", "package_approvals", FakeResp([APPROVAL_ROW]))

    resp = client.post(f"/approvals/{PKG}/approve", json={"notes": "looks good"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["package"]["status"] == "approved"
    assert body["approval"]["decision"] == "approved"

    patch = fake.find("PATCH", "travel_packages")[0]
    assert patch["json"]["status"] == "approved"
    approval = fake.find("POST", "package_approvals")[0]["json"]
    approval = approval[0] if isinstance(approval, list) else approval
    assert approval["reviewer_id"] == UID
    assert approval["decision"] == "approved"


def test_approve_wrong_status(fake):
    fake.route("GET", "travel_packages", FakeResp([_summary_row(status="draft")]))
    resp = client.post(f"/approvals/{PKG}/approve")
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "INVALID_STATUS_TRANSITION"
    assert not fake.find("PATCH", "travel_packages")


def test_approve_not_found(fake):
    fake.route("GET", "travel_packages", FakeResp([]))
    resp = client.post(f"/approvals/{PKG}/approve")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"


def test_reject_ok(fake):
    rejected = dict(
        APPROVAL_ROW, decision="rejected", rejection_reason="at least ten chars"
    )
    fake.route("GET", "travel_packages", FakeResp([_summary_row()]))
    fake.route("PATCH", "travel_packages", FakeResp([_summary_row(status="rejected")]))
    fake.route("POST", "package_approvals", FakeResp([rejected]))

    resp = client.post(
        f"/approvals/{PKG}/reject",
        json={"rejection_reason": "at least ten chars", "notes": "n"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["package"]["status"] == "rejected"
    assert body["approval"]["decision"] == "rejected"
    assert body["approval"]["rejection_reason"] == "at least ten chars"

    approval = fake.find("POST", "package_approvals")[0]["json"]
    approval = approval[0] if isinstance(approval, list) else approval
    assert approval["rejection_reason"] == "at least ten chars"


def test_reject_reason_too_short(fake):
    resp = client.post(f"/approvals/{PKG}/reject", json={"rejection_reason": "short"})
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VALIDATION_ERROR"
    assert fake.calls == []


def test_reject_wrong_status(fake):
    fake.route("GET", "travel_packages", FakeResp([_summary_row(status="live")]))
    resp = client.post(
        f"/approvals/{PKG}/reject", json={"rejection_reason": "at least ten chars"}
    )
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "INVALID_STATUS_TRANSITION"


def test_publish_ok(fake):
    fake.route("GET", "travel_packages", FakeResp([_summary_row(status="approved")]))
    fake.route(
        "PATCH",
        "travel_packages",
        FakeResp(
            [
                _summary_row(
                    status="live", published_at="2026-01-03T00:00:00+00:00"
                )
            ]
        ),
    )
    resp = client.post(f"/approvals/{PKG}/publish")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "live"
    assert body["published_at"] == "2026-01-03T00:00:00+00:00"
    patch = fake.find("PATCH", "travel_packages")[0]
    assert patch["json"]["status"] == "live"
    assert patch["json"]["published_at"]


def test_publish_wrong_status(fake):
    fake.route("GET", "travel_packages", FakeResp([_summary_row(status="draft")]))
    resp = client.post(f"/approvals/{PKG}/publish")
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "INVALID_STATUS_TRANSITION"


def test_publish_not_found(fake):
    fake.route("GET", "travel_packages", FakeResp([]))
    resp = client.post(f"/approvals/{PKG}/publish")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"


@pytest.mark.parametrize("rows", [[{"role": "customer"}], []])
def test_admin_ctx_rejects_non_admin(monkeypatch, rows):
    """The real require_admin_ctx runs; only the user dependency is stubbed."""
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(
        core,
        "requests",
        types.SimpleNamespace(
            get=lambda *a, **k: FakeResp(rows),
            RequestException=FakeRequestException,
        ),
    )
    app.dependency_overrides[core.require_user_ctx] = lambda: dict(CTX)
    try:
        resp = client.get("/approvals")
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "FORBIDDEN"


def test_publish_lost_race_is_409(fake):
    fake.route("GET", "travel_packages", FakeResp([_summary_row(status="approved")]))
    fake.route("PATCH", "travel_packages", FakeResp([]))
    fake.route("GET", "travel_packages", FakeResp([_summary_row(status="archived")]))
    resp = client.post(f"/approvals/{PKG}/publish")
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "INVALID_STATUS_TRANSITION"


def test_approve_lost_race_rolls_back_audit_row(fake):
    fake.route("GET", "travel_packages", FakeResp([_summary_row()]))
    fake.route("POST", "package_approvals", FakeResp([APPROVAL_ROW]))
    fake.route("PATCH", "travel_packages", FakeResp([]))
    fake.route("DELETE", "package_approvals", FakeResp([], 204))
    fake.route("GET", "travel_packages", FakeResp([_summary_row(status="rejected")]))
    resp = client.post(f"/approvals/{PKG}/approve")
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "INVALID_STATUS_TRANSITION"
    delete = fake.find("DELETE", "package_approvals")[0]
    assert APPROVAL_ROW["approval_id"] in delete["params"]["approval_id"]
