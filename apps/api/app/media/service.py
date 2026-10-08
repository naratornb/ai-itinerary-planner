import logging
import os
import re
from uuid import uuid4

import requests

from app import core
from app.packages.service import UpstreamError

logger = logging.getLogger(__name__)

# Every Supabase call for media lives here, so tests only stub
# `app.media.service.requests`.

BUCKET = "package-media"
MIME_TYPES = {
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "video/mp4": "video",
    "video/quicktime": "video",
}
# TODO:: spec allows 200 MB video; Supabase free tier caps files at 50 MB.
SIZE_LIMITS = {"image": 10 * 1024 * 1024, "video": 50 * 1024 * 1024}

_ITEM_SELECT = (
    "media_id,package_id,media_type,url,thumbnail_url,caption,is_cover,"
    "sort_order,uploaded_at"
)

# Raised by the package_media_before_delete DB trigger (migration 0013) when
# a concurrent submit/save flips the package out of draft/rejected between
# this module's own precheck and the actual DELETE. A known race, not an
# unexpected upstream failure — map it to the existing 409 contract instead
# of the generic sanitized 502.
_NOT_EDITABLE_MARKER = "PACKAGE_NOT_EDITABLE"


def _raise_sanitized(method: str, table: str, response) -> None:
    logger.error(
        "PostgREST %s %s failed (%s): %s",
        method, table, response.status_code, response.text,
    )
    raise UpstreamError(502, "Upstream database error.")


def _call(method: str, table: str, check: bool = True, **kwargs):
    # Local twin of packages.service._call so tests can stub this module's
    # `requests` alone (same reason approvals has its own copy).
    # check=False returns the raw response instead of raising, for the one
    # caller (delete_media) that needs to inspect a non-ok body itself
    # before deciding whether it's the sanitized 502 or a known 409 — it
    # still routes through _raise_sanitized for anything else, so there is
    # exactly one place that decides how upstream errors get logged/masked.
    try:
        response = getattr(requests, method)(
            f"{core.SUPABASE_URL}/rest/v1/{table}", timeout=15, **kwargs
        )
    except requests.RequestException:
        raise UpstreamError(503, "Database unreachable.")
    if not check:
        return response
    if not response.ok:
        _raise_sanitized(method, table, response)
    return response


def _storage_headers(ctx):
    return {
        "apikey": core.SUPABASE_ANON_KEY,
        "Authorization": ctx["headers"]["Authorization"],
    }


def _object_url(path):
    return f"{core.SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}"


def list_media(package_id, headers):
    exists = _call(
        "get",
        "travel_packages",
        params={"package_id": f"eq.{package_id}", "select": "package_id"},
        headers=headers,
    ).json()
    if not exists:
        return "not_found", None
    rows = _call(
        "get",
        "package_media",
        params={
            "package_id": f"eq.{package_id}",
            "select": _ITEM_SELECT,
            "order": "sort_order.asc",
        },
        headers=headers,
    ).json()
    return "ok", rows


def _delete_object(path, ctx):
    try:
        requests.delete(_object_url(path), headers=_storage_headers(ctx), timeout=15)
    except requests.RequestException:
        pass


def upload_media(ctx, package_id, file, is_cover, sort_order):
    headers = ctx["headers"]
    rows = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "select": "package_id,status",
        },
        headers=headers,
    ).json()
    if not rows:
        return "not_found", None
    if rows[0].get("status") not in ("draft", "rejected"):
        return "not_editable", None

    media_type = MIME_TYPES.get(file.content_type or "")
    if not media_type:
        return "unsupported_type", None

    # Size check before read() so the cap bounds memory, not just the row.
    # ponytail: Starlette still parses the multipart body to /tmp before auth
    # runs; a platform-level body limit is the real guard for hostile posts.
    limit = SIZE_LIMITS[media_type]
    if (file.size or 0) > limit:
        return "too_large", limit // (1024 * 1024)
    data = file.file.read()
    if len(data) > limit:
        return "too_large", limit // (1024 * 1024)

    filename = os.path.basename(file.filename or "upload")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    path = f"{package_id}/{uuid4().hex}-{safe}"
    try:
        response = requests.post(
            _object_url(path),
            headers={**_storage_headers(ctx), "Content-Type": file.content_type},
            data=data,
            timeout=30,
        )
    except requests.RequestException:
        raise UpstreamError(503, "Storage unreachable.")
    if not response.ok:
        logger.error("Storage upload failed (%s): %s", response.status_code, response.text)
        raise UpstreamError(502, "Upstream storage error.")

    try:
        row = _call(
            "post",
            "package_media",
            json={
                "package_id": package_id,
                "uploaded_by": ctx["uid"],
                "media_type": media_type,
                "url": (
                    f"{core.SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"
                ),
                "filename": filename,
                "file_size_bytes": len(data),
                "is_cover": is_cover,
                "sort_order": sort_order,
            },
            headers={**headers, "Prefer": "return=representation"},
        ).json()[0]
    except UpstreamError:
        # ponytail: best-effort cleanup, orphaned objects need a sweep job if
        # this ever matters
        _delete_object(path, ctx)
        raise
    if is_cover:
        # Demote other covers after the insert, so a failure can't leave the
        # package coverless; a failed demotion leaves two covers (recoverable).
        _call(
            "patch",
            "package_media",
            params={
                "package_id": f"eq.{package_id}",
                "is_cover": "eq.true",
                "media_id": f"neq.{row['media_id']}",
            },
            json={"is_cover": False},
            headers=headers,
        )
    return "ok", row


def delete_media(media_id, ctx):
    headers = ctx["headers"]
    rows = _call(
        "get",
        "package_media",
        params={
            "media_id": f"eq.{media_id}",
            "select": "media_id,package_id,url,travel_packages(status)",
        },
        headers=headers,
    ).json()
    if not rows:
        return "not_found", None
    parent = rows[0].get("travel_packages") or {}
    if parent.get("status") not in ("draft", "rejected"):
        return "not_editable", None

    # Row first: a DB failure then leaves an orphaned object (tolerated),
    # not a live row pointing at a deleted file. check=False: this call
    # must inspect the trigger's rejection text itself before falling back
    # to _call's own sanitized 502 for anything else.
    response = _call(
        "delete",
        "package_media",
        params={"media_id": f"eq.{media_id}"},
        headers=headers,
        check=False,
    )
    if not response.ok:
        if _NOT_EDITABLE_MARKER in (response.text or ""):
            return "not_editable", None
        _raise_sanitized("delete", "package_media", response)
    url = rows[0].get("url") or ""
    if f"/{BUCKET}/" in url:
        _delete_object(url.split(f"/{BUCKET}/", 1)[1], ctx)
    return "ok", None
