import logging
import time
from math import ceil

import requests
from requests import RequestException

from app import core
from app.packages.service import UpstreamError, _now, get_package_detail

logger = logging.getLogger(__name__)


# Local twin of packages.service._call so tests can stub this module's requests alone.
def _call(method: str, table: str, **kwargs):
    try:
        response = getattr(requests, method)(
            f"{core.SUPABASE_URL}/rest/v1/{table}", timeout=15, **kwargs
        )
    except RequestException:
        raise UpstreamError(503, "Database unreachable.")
    if not response.ok:
        # Upstream detail goes to logs only — never to the client.
        logger.error(
            "PostgREST %s %s failed (%s): %s",
            method, table, response.status_code, response.text,
        )
        raise UpstreamError(502, "Upstream database error.")
    return response


def _generate(prompt, package):
    """Canned itinerary text.

    TODO:: wire a real LLM (spec: RAG pipeline, <=10 s SLA); this stub keeps
    the endpoint contract testable without an API key.
    """
    city = package.get("destination_city") or package.get("destination_country") or ""
    days = min(package.get("duration_days") or 1, 3)
    header = (
        f"# Suggested itinerary for {package.get('title')}\n\n"
        f"_Draft for: {prompt}_\n\n"
    )
    return header + "\n".join(f"## Day {n} — explore {city}" for n in range(1, days + 1))


def create_suggestion(headers, uid, package_id, prompt):
    # creator_id filter: suggestions are own-only per spec; without it a
    # foreign *live* package would pass the RLS visibility check.
    rows = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "creator_id": f"eq.{uid}",
            "select": (
                "package_id,title,destination_city,destination_country,duration_days"
            ),
        },
        headers=headers,
    ).json()
    if not rows:
        return "not_found", None

    started = time.monotonic()
    text = _generate(prompt, rows[0])
    elapsed_ms = int((time.monotonic() - started) * 1000)

    created = _call(
        "post",
        "ai_suggestions",
        json={
            "package_id": package_id,
            "prompt": prompt,
            "suggestion_text": text,
            "status": "pending",
            "response_time_ms": elapsed_ms,
        },
        headers={**headers, "Prefer": "return=representation"},
    ).json()
    return "ok", created[0]


def list_suggestions(headers, uid, package_id, status, page, per_page):
    exists = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "creator_id": f"eq.{uid}",
            "select": "package_id",
        },
        headers=headers,
    ).json()
    if not exists:
        return "not_found", None, None

    params = {
        "package_id": f"eq.{package_id}",
        "order": "generated_at.desc",
        "limit": per_page,
        "offset": (page - 1) * per_page,
    }
    if status:
        params["status"] = f"eq.{status}"
    response = _call(
        "get", "ai_suggestions", params=params,
        headers={**headers, "Prefer": "count=exact"},
    )
    content_range = response.headers.get("Content-Range", "") if response.headers else ""
    tail = content_range.rsplit("/", 1)[-1]
    total = int(tail) if tail.isdigit() else 0
    meta = {
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": ceil(total / per_page) if total else 0,
    }
    return "ok", response.json(), meta


def _resolve(headers, suggestion_id, new_status, body_extra=None):
    """Shared accept/dismiss transition; both only act on `pending` rows."""
    rows = _call(
        "get",
        "ai_suggestions",
        params={"suggestion_id": f"eq.{suggestion_id}"},
        headers=headers,
    ).json()
    if not rows:
        return "not_found", None
    if rows[0].get("status") != "pending":
        return "already_resolved", rows[0].get("status")

    updated = _call(
        "patch",
        "ai_suggestions",
        params={"suggestion_id": f"eq.{suggestion_id}", "status": "eq.pending"},
        json={"status": new_status, **(body_extra or {})},
        headers={**headers, "Prefer": "return=representation"},
    ).json()
    if not updated:
        # Race guard: someone else resolved it between the read and the write.
        current = _call(
            "get",
            "ai_suggestions",
            params={"suggestion_id": f"eq.{suggestion_id}", "select": "status"},
            headers=headers,
        ).json()
        if not current:
            return "not_found", None
        return "already_resolved", current[0].get("status")
    return "ok", updated[0]


def accept_suggestion(headers, uid, suggestion_id, auto_apply):
    outcome, result = _resolve(
        headers, suggestion_id, "accepted", {"accepted_at": _now()}
    )
    if outcome != "ok":
        return outcome, result
    package = None
    if auto_apply:
        # TODO:: auto_apply should parse suggestion_text into flight/hotel/activity
        # records (and enforce the spec's draft/rejected precondition);
        # currently returns the package unchanged.
        package = get_package_detail(result["package_id"], headers, uid)
    return "ok", {"suggestion": result, "package": package}


def dismiss_suggestion(headers, suggestion_id):
    return _resolve(headers, suggestion_id, "dismissed")
