import copy
import types

import pytest
from fastapi.testclient import TestClient

from app import core
from app.main import app
from app.media import service

client = TestClient(app)

UID = "u0000000-0000-0000-0000-000000000001"
PKG = "b0000000-0000-0000-0000-000000000001"
MID = "c0000000-0000-0000-0000-000000000001"
USER_HEADERS = {"apikey": "anon-key", "Authorization": "Bearer user-token"}
OBJECT_URL = "https://sb/storage/v1/object/public/package-media/p/x.jpg"


class FakeResp:
    def __init__(self, payload, status_code=200, headers=None):
        self._payload = payload
        self.status_code = status_code
        self.ok = status_code < 400
        self.headers = headers or {}
        self.text = str(payload)

    def json(self):
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

    def _call(self, method, url, **kw):
        # **kw, not a fixed signature: the storage upload sends data=/files=.
        self.calls.append({"method": method, "url": url, **kw})
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
    assert not fr.queue, f"unconsumed routes: {fr.queue}"


MEDIA_ROW = {
    "media_id": MID,
    "package_id": PKG,
    "media_type": "image",
    "url": OBJECT_URL,
    "thumbnail_url": None,
    "caption": None,
    "is_cover": True,
    "sort_order": 0,
    "uploaded_at": "2026-01-01T00:00:00+00:00",
}


def _upload(fake_file=(b"xxxx", "image/jpeg"), **form):
    body, mime = fake_file
    data = {"package_id": PKG, "is_cover": "true", "sort_order": "0"}
    data.update(form)
    return client.post(
        "/media/upload",
        data=data,
        files={"file": ("photo.jpg", body, mime)},
    )


def test_list_media(fake):
    fake.route("GET", "travel_packages", FakeResp([{"package_id": PKG}]))
    fake.route("GET", "package_media", FakeResp([MEDIA_ROW]))

    resp = client.get(f"/media/{PKG}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["data"][0]["media_id"] == MID
    assert body["data"][0]["is_cover"] is True

    call = fake.find("GET", "package_media")[0]
    assert call["params"]["package_id"] == f"eq.{PKG}"
    assert call["params"]["order"] == "sort_order.asc"
    assert call["headers"]["Authorization"] == USER_HEADERS["Authorization"]


def test_list_media_unknown_package(fake):
    fake.route("GET", "travel_packages", FakeResp([]))
    resp = client.get(f"/media/{PKG}")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"


def test_list_media_unauthorized(monkeypatch):
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(core, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    assert core.require_user_ctx not in app.dependency_overrides
    resp = client.get(f"/media/{PKG}")
    assert resp.status_code == 401


def test_upload_image_sets_cover(fake):
    fake.route(
        "GET",
        "travel_packages",
        FakeResp([{"package_id": PKG, "creator_id": UID, "status": "draft"}]),
    )
    fake.route("PATCH", "package_media", FakeResp([]))
    fake.route("POST", "/storage/v1/object", FakeResp({"Key": "package-media/p/x.jpg"}))
    fake.route(
        "POST",
        "/rest/v1/package_media",
        FakeResp(
            [
                dict(
                    MEDIA_ROW,
                    filename="photo.jpg",
                    file_size_bytes=4,
                )
            ]
        ),
    )

    resp = _upload()
    assert resp.status_code == 201
    body = resp.json()
    assert body["media_type"] == "image"
    assert body["filename"] == "photo.jpg"
    assert body["package_id"] == PKG
    assert fake.find("POST", "/storage/v1/object")

    insert = fake.find("POST", "/rest/v1/package_media")[0]["json"]
    assert insert["filename"] == "photo.jpg"
    assert insert["file_size_bytes"] == 4
    assert insert["uploaded_by"] == UID
    assert insert["is_cover"] is True
    assert insert["media_type"] == "image"
    assert f"/object/public/package-media/{PKG}/" in insert["url"]

    # is_cover=true must demote only this package's other covers.
    demote = fake.find("PATCH", "package_media")[0]["params"]
    assert demote["package_id"] == f"eq.{PKG}"
    assert demote["is_cover"] == "eq.true"
    assert demote["media_id"] == f"neq.{MID}"


def test_upload_non_cover_skips_demotion(fake):
    fake.route("GET", "travel_packages", FakeResp([{"package_id": PKG, "status": "draft"}]))
    fake.route("POST", "/storage/v1/object", FakeResp({"Key": "package-media/p/x.jpg"}))
    fake.route("POST", "/rest/v1/package_media", FakeResp([dict(MEDIA_ROW, is_cover=False)]))
    resp = _upload(is_cover="false")
    assert resp.status_code == 201
    assert not fake.find("PATCH", "package_media")


def test_upload_unknown_package(fake):
    fake.route("GET", "travel_packages", FakeResp([]))
    resp = _upload()
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"


def test_upload_bad_mime(fake):
    fake.route(
        "GET",
        "travel_packages",
        FakeResp([{"package_id": PKG, "creator_id": UID, "status": "draft"}]),
    )
    resp = _upload(fake_file=(b"hello", "text/plain"))
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "UNSUPPORTED_FILE_TYPE"
    assert not fake.find("POST", "/storage/v1/object")


def test_upload_package_not_editable(fake):
    fake.route(
        "GET",
        "travel_packages",
        FakeResp([{"package_id": PKG, "creator_id": UID, "status": "live"}]),
    )
    resp = _upload()
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "PACKAGE_NOT_EDITABLE"
    assert not fake.find("POST", "/storage/v1/object")


def test_upload_image_too_large(fake):
    fake.route(
        "GET",
        "travel_packages",
        FakeResp([{"package_id": PKG, "creator_id": UID, "status": "draft"}]),
    )
    resp = _upload(fake_file=(b"x" * (10 * 1024 * 1024 + 1), "image/jpeg"))
    assert resp.status_code == 400
    body = resp.json()
    assert body["error_code"] == "FILE_TOO_LARGE"
    assert "10 MB" in body["message"]
    assert not fake.find("POST", "/storage/v1/object")


def _media_row_with_package(status="draft"):
    return {
        "media_id": MID,
        "package_id": PKG,
        "url": OBJECT_URL,
        "travel_packages": {"status": status, "creator_id": UID},
    }


def test_delete_media(fake):
    fake.route("GET", "package_media", FakeResp([_media_row_with_package()]))
    fake.route("DELETE", "/storage/v1/object", FakeResp({}, 200))
    fake.route("DELETE", "/rest/v1/package_media", FakeResp([], 204))

    resp = client.delete(f"/media/{MID}")
    assert resp.status_code == 204
    assert resp.content == b""
    obj_delete = fake.find("DELETE", "/storage/v1/object")[0]
    assert obj_delete["url"].endswith("/package-media/p/x.jpg")
    row_delete = fake.find("DELETE", "/rest/v1/package_media")
    assert row_delete and row_delete[0]["params"]["media_id"] == f"eq.{MID}"


def test_delete_media_not_editable(fake):
    fake.route("GET", "package_media", FakeResp([_media_row_with_package("live")]))
    resp = client.delete(f"/media/{MID}")
    assert resp.status_code == 409
    assert resp.json()["error_code"] == "PACKAGE_NOT_EDITABLE"
    assert not fake.find("DELETE", "/storage/v1/object")


def test_delete_media_unknown(fake):
    fake.route("GET", "package_media", FakeResp([]))
    resp = client.delete(f"/media/{MID}")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "NOT_FOUND"
