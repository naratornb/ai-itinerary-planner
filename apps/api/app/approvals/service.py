import logging
from math import ceil

import requests
from requests import RequestException

from app import core
from app.packages.service import _LIST_SELECT, UpstreamError, _cover_url, _now

logger = logging.getLogger(__name__)

# Every PostgREST call in the approvals feature lives here, so tests only have
# to stub `app.approvals.service.requests`.

_MEDIA_ORDER = "is_cover.desc,sort_order.asc"
_SORT_MAP = {
    "submitted_at_asc": "submitted_at.asc",
    "submitted_at_desc": "submitted_at.desc",
}


def _call(method: str, table: str, **kwargs):
    try:
        response = getattr(requests, method)(
            f"{core.SUPABASE_URL}/rest/v1/{table}", timeout=15, **kwargs
        )
    except RequestException:
        raise UpstreamError(503, "Database unreachable.")
    if not response.ok:
        logger.error(
            "PostgREST %s %s failed (%s): %s",
            method, table, response.status_code, response.text,
        )
        raise UpstreamError(502, "Upstream database error.")
    return response


def list_pending(headers, page, per_page, sort):
    response = _call(
        "get",
        "travel_packages",
        params={
            "status": "eq.pending_review",
            "select": _LIST_SELECT,
            "package_media.order": _MEDIA_ORDER,
            "order": _SORT_MAP[sort],
            "limit": per_page,
            "offset": (page - 1) * per_page,
        },
        headers={**headers, "Prefer": "count=exact"},
    )
    content_range = response.headers.get("Content-Range", "") if response.headers else ""
    tail = content_range.rsplit("/", 1)[-1]
    total = int(tail) if tail.isdigit() else 0

    rows = response.json()
    for row in rows:
        row["cover_image_url"] = _cover_url(row.pop("package_media", []))
    meta = {
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": ceil(total / per_page) if total else 0,
    }
    return rows, meta


def _summary(row):
    row["cover_image_url"] = _cover_url(row.pop("package_media", []))
    return row


def _fetch(package_id, headers):
    rows = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "select": _LIST_SELECT,
            "package_media.order": _MEDIA_ORDER,
        },
        headers=headers,
    ).json()
    return rows[0] if rows else None


def decide(package_id, ctx, decision, rejection_reason=None, notes=None):
    """Approve/reject a pending_review package and record the decision."""
    row = _fetch(package_id, ctx["headers"])
    if not row:
        return "not_found", None
    if row.get("status") != "pending_review":
        return "invalid_status", row.get("status")

    # ponytail: two HTTP calls, not a transaction — move to a Postgres RPC if
    # audit integrity ever matters more than this. Audit row goes first (an
    # orphan is recoverable; an unaudited status change is not), and is
    # best-effort deleted when the status PATCH loses a race or fails.
    approval = _call(
        "post",
        "package_approvals",
        json={
            "package_id": package_id,
            "reviewer_id": ctx["uid"],
            "decision": decision,
            "rejection_reason": rejection_reason,
            "notes": notes,
        },
        headers={**ctx["headers"], "Prefer": "return=representation"},
    ).json()[0]

    status = "approved" if decision == "approved" else "rejected"
    try:
        updated = _call(
            "patch",
            "travel_packages",
            params={
                "package_id": f"eq.{package_id}",
                "status": "eq.pending_review",
                "select": _LIST_SELECT,
                "package_media.order": _MEDIA_ORDER,
            },
            json={"status": status, "updated_at": _now()},
            headers={**ctx["headers"], "Prefer": "return=representation"},
        ).json()
    except UpstreamError:
        _delete_approval(approval)
        raise
    if not updated:
        # Lost a race: another decision landed between fetch and PATCH.
        _delete_approval(approval)
        row = _fetch(package_id, ctx["headers"])
        if not row:
            return "not_found", None
        return "invalid_status", row.get("status")
    return "ok", {"package": _summary(updated[0]), "approval": approval}


def _delete_approval(approval):
    """Best-effort audit-row rollback. Service role: RLS has no DELETE policy."""
    try:
        _call(
            "delete",
            "package_approvals",
            params={"approval_id": f"eq.{approval.get('approval_id')}"},
            headers=core._admin_headers(),
        )
    except UpstreamError:
        logger.error("orphan package_approvals row %s", approval.get("approval_id"))


def publish(package_id, headers):
    row = _fetch(package_id, headers)
    if not row:
        return "not_found", None
    if row.get("status") != "approved":
        return "invalid_status", row.get("status")

    now = _now()
    updated = _call(
        "patch",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "status": "eq.approved",
            "select": _LIST_SELECT,
            "package_media.order": _MEDIA_ORDER,
        },
        json={"status": "live", "published_at": now, "updated_at": now},
        headers={**headers, "Prefer": "return=representation"},
    ).json()
    if not updated:
        # Lost a race — re-check; a still-visible row means the status moved.
        row = _fetch(package_id, headers)
        if not row:
            return "not_found", None
        return "invalid_status", row.get("status")
    return "ok", _summary(updated[0])
