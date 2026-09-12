import logging
from datetime import datetime, timezone
from math import ceil

import requests
from requests import RequestException

from app import core
from app.core import _admin_headers

logger = logging.getLogger(__name__)

# Every PostgREST call for package rows lives in this module (including the
# public marketplace detail), so tests only stub `app.packages.service.requests`.

# Nested PostgREST embed for the marketplace detail page. Ordering is
# done by PostgREST (order= params), not in Python. influencer_profiles
# hangs off profiles, not the package, hence the nesting.
_DETAIL_SELECT = (
    "*,"
    "creator:profiles!creator_id(full_name,avatar_url,"
    "influencer_profiles(bio,instagram_handle,tiktok_handle,follower_count,verified)),"
    "package_media(*),package_days(*),"
    "package_flights(*,flights(*)),"
    "package_hotels(*,hotels(*)),"
    "package_activities(*,activities(*))"
)

_SUMMARY_SELECT = (
    "package_id,title,destination_country,destination_city,duration_days,"
    "base_price_aud,status,creator_id,created_at,submitted_at,published_at"
)
_LIST_SELECT = _SUMMARY_SELECT + ",package_media(url,is_cover)"

SORT_MAP = {
    "created_at_desc": "created_at.desc",
    "created_at_asc": "created_at.asc",
    "price_asc": "base_price_aud.asc",
    "price_desc": "base_price_aud.desc",
}


class UpstreamError(Exception):
    """A PostgREST call failed; carries the status the client should see."""

    def __init__(self, status_code: int, message: str, error_code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        # None means the router falls back to its generic UPSTREAM_ERROR
        # code; callers that know a more specific, documented code applies
        # (e.g. save preconditions) pass it explicitly.
        self.error_code = error_code


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


def _now():
    return datetime.now(timezone.utc).isoformat()


def _cover_url(media):
    return (media[0] or {}).get("url") if media else None


def list_packages(headers, uid, page, per_page, status, sort):
    params = {
        "creator_id": f"eq.{uid}",
        "select": _LIST_SELECT,
        "package_media.order": "is_cover.desc,sort_order.asc",
        "order": SORT_MAP[sort],
        "limit": per_page,
        "offset": (page - 1) * per_page,
    }
    if status:
        params["status"] = f"eq.{status}"
    response = _call(
        "get", "travel_packages", params=params,
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


_DETAIL_ORDER_PARAMS = {
    "package_media.order": "is_cover.desc,sort_order.asc",
    "package_days.order": "day_number.asc",
    "package_flights.order": "day_number.asc,sequence_order.asc",
    "package_activities.order": "day_number.asc,sequence_order.asc",
    # Hotels have no native sequence_order column (it only lives inside
    # `details`), so without a PostgREST order clause the row order is
    # arbitrary. This is a best-effort ordering hint; _to_detail below sorts
    # again in Python so the result is total and stable either way.
    "package_hotels.order": "check_in_day.asc,check_in_date.asc",
}


def get_package_detail(package_id, headers, uid):
    response = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "creator_id": f"eq.{uid}",
            "select": _DETAIL_SELECT,
            **_DETAIL_ORDER_PARAMS,
        },
        headers=headers,
    )
    rows = response.json()
    return _to_detail(rows[0]) if rows else None


def get_public_package_detail(package_id):
    """Anon-key detail lookup; RLS limits visibility to live packages."""
    response = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "select": _DETAIL_SELECT,
            **_DETAIL_ORDER_PARAMS,
        },
        headers={
            "apikey": core.SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {core.SUPABASE_ANON_KEY}",
        },
    )
    rows = response.json()
    return _to_detail(rows[0]) if rows else None


def _flight_from_row(pf):
    """A saved component's `details` is its complete authoritative
    snapshot (Task B); legacy rows (details IS NULL) fall back to the
    catalog-plus-junction read path."""
    details = pf.get("details")
    if details:
        return {
            "flight_id": pf.get("flight_id"),
            "package_component_id": pf.get("id"),
            "sequence_order": details.get("sequence_order"),
            "origin_iata": details.get("origin_iata"),
            "destination_iata": details.get("destination_iata"),
            "airline": details.get("airline"),
            "flight_number": details.get("flight_number"),
            "departure_datetime": details.get("departure_datetime"),
            "arrival_datetime": details.get("arrival_datetime"),
            "cabin_class": details.get("cabin_class"),
            "price_aud": details.get("price_aud"),
            "day_number": details.get("day_number"),
            "notes": details.get("notes"),
            "media_ids": details.get("media_ids") or [],
            "source_id": details.get("source_id"),
        }
    catalog = pf.get("flights") or {}
    return {
        "flight_id": pf.get("flight_id"),
        "package_component_id": pf.get("id"),
        "sequence_order": pf.get("sequence_order"),
        "origin_iata": catalog.get("origin"),
        "destination_iata": catalog.get("destination"),
        "airline": catalog.get("airline"),
        "flight_number": catalog.get("flight_number"),
        "departure_datetime": catalog.get("departure_datetime"),
        "arrival_datetime": catalog.get("arrival_datetime"),
        "cabin_class": catalog.get("cabin_class"),
        "price_aud": catalog.get("price_aud"),
        "day_number": pf.get("day_number"),
        "notes": pf.get("notes"),
        "media_ids": [],
        "source_id": None,
    }


def _hotel_from_row(ph):
    """Returns (detail_dict, nights). `nights` is always read from the
    native synchronized column: the save RPC already resolves it to one
    stay's actual duration (concrete dates win over relative days), so a
    checkout-boundary render never gets billed as a second stay."""
    details = ph.get("details")
    nights = ph.get("nights") or 0
    if details:
        return {
            "hotel_id": ph.get("hotel_id"),
            "package_component_id": ph.get("id"),
            "sequence_order": details.get("sequence_order"),
            "hotel_name": details.get("hotel_name"),
            "star_rating": details.get("star_rating"),
            "city": details.get("city"),
            "address": details.get("address"),
            "check_in_date": details.get("check_in_date") or ph.get("check_in_date"),
            "check_out_date": details.get("check_out_date") or ph.get("check_out_date"),
            "check_in_day": details.get("check_in_day"),
            "check_out_day": details.get("check_out_day"),
            "price_per_night_aud": details.get("price_per_night_aud"),
            "room_type": details.get("room_type"),
            "notes": details.get("notes"),
            "media_ids": details.get("media_ids") or [],
            "source_id": details.get("source_id"),
        }, nights
    catalog = ph.get("hotels") or {}
    return {
        "hotel_id": ph.get("hotel_id"),
        "package_component_id": ph.get("id"),
        "sequence_order": None,
        "hotel_name": catalog.get("hotel_name"),
        "star_rating": catalog.get("star_rating"),
        "city": catalog.get("city"),
        "address": catalog.get("address"),
        "check_in_date": ph.get("check_in_date"),
        "check_out_date": ph.get("check_out_date"),
        "check_in_day": ph.get("check_in_day"),
        "check_out_day": ph.get("check_out_day"),
        "price_per_night_aud": catalog.get("price_per_night_aud"),
        "room_type": catalog.get("room_type"),
        "notes": ph.get("notes"),
        "media_ids": [],
        "source_id": None,
    }, nights


def _activity_from_row(pa):
    details = pa.get("details")
    if details:
        return {
            "activity_id": pa.get("activity_id"),
            "package_component_id": pa.get("id"),
            "sequence_order": details.get("sequence_order"),
            "activity_name": details.get("activity_name"),
            "activity_date": details.get("activity_date") or pa.get("activity_date"),
            "city": details.get("city"),
            "day_number": details.get("day_number"),
            "start_time": details.get("start_time"),
            "duration_hours": details.get("duration_hours"),
            "price_aud": details.get("price_aud"),
            "category": details.get("category"),
            "address": details.get("address"),
            "notes": details.get("notes"),
            "description": details.get("description"),
            "booking_required": details.get("booking_required"),
            "media_ids": details.get("media_ids") or [],
            "source_id": details.get("source_id"),
        }
    catalog = pa.get("activities") or {}
    return {
        "activity_id": pa.get("activity_id"),
        "package_component_id": pa.get("id"),
        "sequence_order": pa.get("sequence_order"),
        "activity_name": catalog.get("activity_name"),
        "activity_date": pa.get("activity_date"),
        "city": catalog.get("city"),
        "day_number": pa.get("day_number"),
        "start_time": None,
        "duration_hours": catalog.get("duration_hours"),
        "price_aud": catalog.get("price_aud"),
        "category": None,
        "address": None,
        "notes": pa.get("notes"),
        "description": catalog.get("description"),
        "booking_required": catalog.get("booking_required"),
        "media_ids": [],
        "source_id": None,
    }


def _to_detail(row):
    """Flatten the junction embeds into the flat *Detail shapes. Prefers
    each component's typed `details` snapshot when present (Task B save
    path); falls back to the legacy catalog-plus-junction read path when
    `details IS NULL`."""
    row["media"] = row.pop("package_media", []) or []
    days = row.pop("package_days", []) or []
    row["days"] = [{**d, "media_ids": d.get("media_ids") or []} for d in days]

    flights = [_flight_from_row(pf) for pf in row.pop("package_flights", []) or []]
    for i, flight in enumerate(flights):
        flight["sequence_order"] = flight["sequence_order"] or i + 1
    row["flights"] = flights

    package_hotels = row.pop("package_hotels", []) or []
    hotels_with_nights = [_hotel_from_row(ph) for ph in package_hotels]
    # Hotels have no native ordering column (see _DETAIL_ORDER_PARAMS), so
    # PostgREST's row order isn't reliable on its own. Sort here with a
    # total, stable key so repeated GETs render stays in the same order;
    # sentinels stand in for None so the tuple comparison never raises.
    hotels_with_nights.sort(
        key=lambda pair: (
            pair[0]["sequence_order"] if pair[0]["sequence_order"] is not None else 10**9,
            pair[0]["check_in_day"] if pair[0]["check_in_day"] is not None else 10**9,
            pair[0]["package_component_id"] or "",
        )
    )
    for i, (hotel, _nights) in enumerate(hotels_with_nights):
        hotel["sequence_order"] = hotel["sequence_order"] or i + 1
    row["hotels"] = [hotel for hotel, _nights in hotels_with_nights]

    activities = [_activity_from_row(pa) for pa in row.pop("package_activities", []) or []]
    for i, activity in enumerate(activities):
        activity["sequence_order"] = activity["sequence_order"] or i + 1
    row["activities"] = activities
    # Informational breakdown from effective saved/catalog prices; null
    # prices count as 0. base_price_aud stays the creator-set display
    # price — the API asserts nothing about which total is "the" price.
    flights_total = sum(f["price_aud"] or 0 for f in row["flights"])
    hotels_total = sum(
        (hotel["price_per_night_aud"] or 0) * nights
        for hotel, nights in hotels_with_nights
    )
    activities_total = sum(a["price_aud"] or 0 for a in row["activities"])
    row["pricing"] = {
        "flights_total": flights_total,
        "hotels_total": hotels_total,
        "activities_total": activities_total,
        "components_total": flights_total + hotels_total + activities_total,
        "base_price_aud": row.get("base_price_aud"),
    }
    row["cover_image_url"] = _cover_url(row["media"])
    # ponytail: approvals RLS is admin-only, wire when the approvals feature lands.
    row["latest_approval"] = None
    return row


def _save_package_details(uid, package_id, body):
    """Single write path for create and update: one atomic RPC transaction.

    Called with service-role headers — p_actor_id is the token-derived uid,
    never client-supplied, and the function checks ownership itself.
    """
    return _call(
        "post",
        "rpc/save_package_details",
        json={"p_actor_id": uid, "p_package_id": package_id, "p_payload": body},
        headers=_admin_headers(),
    ).json()


def _raise_for_failed_outcome(result):
    """Surface an RPC precondition failure as the existing sanitized-error
    contract. `outcome` here is never not_found/not_editable/ok — callers
    handle those themselves; anything else is a validation failure that
    needs package state to check (duration bounds, media ownership, ...)."""
    details = result.get("details") or {}
    failures = details.get("failures") or [f"save failed: {result.get('outcome')}"]
    raise UpstreamError(422, " ".join(failures), error_code="SAVE_PRECONDITION_FAILED")


def create_package(uid, headers, payload):
    body = {
        "title": payload.title,
        "description": payload.description,
        "destination_country": payload.destination_country,
        "destination_city": payload.destination_city,
        "duration_days": payload.duration_days,
        "base_price_aud": payload.base_price_aud,
        "max_group_size": payload.max_group_size,
        "tags": payload.tags,
        "flights": [f.model_dump(mode="json") for f in payload.flights],
        "hotels": [h.model_dump(mode="json") for h in payload.hotels],
        "activities": [a.model_dump(mode="json") for a in payload.activities],
        "days": [d.model_dump(mode="json") for d in payload.days],
    }
    result = _save_package_details(uid, None, body)
    if result.get("outcome") != "ok":
        _raise_for_failed_outcome(result)
    return get_package_detail(result["package_id"], headers, uid)


def update_package(package_id, headers, uid, payload):
    # Per section 1: omission means unchanged, [] clears, explicit null is
    # 422 for flights/hotels/activities (enforced in schemas.py already).
    # days: null stays "no change" for backward compatibility. Presence of
    # a key in `body` is exactly "the caller supplied this collection" —
    # component objects are fully re-dumped (not exclude_unset) so every
    # field lands in the RPC payload with its proper default, not silently
    # missing from the jsonb.
    fields_set = payload.model_fields_set
    body = payload.model_dump(
        exclude_unset=True,
        exclude={"flights", "hotels", "activities", "days"},
        mode="json",
    )
    if "flights" in fields_set:
        body["flights"] = [f.model_dump(mode="json") for f in payload.flights]
    if "hotels" in fields_set:
        body["hotels"] = [h.model_dump(mode="json") for h in payload.hotels]
    if "activities" in fields_set:
        body["activities"] = [a.model_dump(mode="json") for a in payload.activities]
    if "days" in fields_set and payload.days is not None:
        body["days"] = [d.model_dump(mode="json") for d in payload.days]

    result = _save_package_details(uid, package_id, body)
    outcome = result.get("outcome")
    if outcome == "not_found":
        return "not_found", None
    if outcome == "not_editable":
        return "not_editable", result.get("status")
    if outcome != "ok":
        _raise_for_failed_outcome(result)
    return "ok", get_package_detail(package_id, headers, uid)


def delete_package(package_id, user_headers):
    select = (
        "status,package_flights(flight_id),package_hotels(hotel_id),"
        "package_activities(activity_id)"
    )

    def _resolve():
        rows = _call(
            "get",
            "travel_packages",
            params={"package_id": f"eq.{package_id}", "select": select},
            headers=user_headers,
        ).json()
        return rows[0] if rows else None

    row = _resolve()
    if not row:
        return "not_found", None
    if row.get("status") != "draft":
        return "not_deletable", row.get("status")

    deleted = _call(
        "delete",
        "travel_packages",
        params={"package_id": f"eq.{package_id}", "status": "eq.draft"},
        headers={**user_headers, "Prefer": "return=representation"},
    ).json()
    if not deleted:
        row = _resolve()
        if not row:
            return "not_found", None
        return "not_deletable", row.get("status")

    # ponytail: spec says delete all associated records; catalog rows have no FK
    # back to the package and would otherwise orphan.
    for table, key in (
        ("flights", "flight_id"),
        ("hotels", "hotel_id"),
        ("activities", "activity_id"),
    ):
        ids = [r[key] for r in row.get(f"package_{table}") or [] if r.get(key)]
        if ids:
            try:
                _call(
                    "delete",
                    table,
                    params={key: f"in.({','.join(ids)})"},
                    headers=_admin_headers(),
                )
            except UpstreamError:
                # Shared seeded catalog rows are FK-RESTRICTed by other packages;
                # the package itself is already gone, so this is best-effort.
                pass
    return "ok", None


def submit_package(package_id, headers, uid, note):
    """Submit is a single atomic RPC: locks the owned package row before
    reading component counts/status (fixing the save/submit race), rather
    than reading components first and only locking for the status write.

    Called with service-role headers — p_actor_id is the token-derived uid,
    never client-supplied, and the function checks ownership itself.
    """
    result = _call(
        "post",
        "rpc/submit_package_for_review",
        json={"p_actor_id": uid, "p_package_id": package_id, "p_note": note},
        headers=_admin_headers(),
    ).json()
    outcome = result.get("outcome")
    if outcome == "not_found":
        return "not_found", None
    if outcome == "precondition_failed":
        return "precondition_failed", result.get("details") or {}
    if outcome != "ok":
        _raise_for_failed_outcome(result)

    updated = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "select": _SUMMARY_SELECT + ",package_media(url,is_cover)",
            "package_media.order": "is_cover.desc,sort_order.asc",
        },
        headers=headers,
    ).json()
    if not updated:
        return "not_found", None
    summary = updated[0]
    summary["cover_image_url"] = _cover_url(summary.pop("package_media", []))
    return "ok", summary
