import logging
from datetime import datetime, timezone
from math import ceil
from uuid import uuid4

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

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


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


def _to_detail(row):
    """Flatten the junction+catalog embeds into the flat *Detail shapes."""
    row["media"] = row.pop("package_media", []) or []
    row["days"] = row.pop("package_days", []) or []

    row["flights"] = [
        {
            "flight_id": pf.get("flight_id"),
            "sequence_order": pf.get("sequence_order") or i + 1,
            "origin_iata": (pf.get("flights") or {}).get("origin"),
            "destination_iata": (pf.get("flights") or {}).get("destination"),
            "airline": (pf.get("flights") or {}).get("airline"),
            "flight_number": (pf.get("flights") or {}).get("flight_number"),
            "departure_datetime": (pf.get("flights") or {}).get("departure_datetime"),
            "arrival_datetime": (pf.get("flights") or {}).get("arrival_datetime"),
            "cabin_class": (pf.get("flights") or {}).get("cabin_class"),
            "price_aud": (pf.get("flights") or {}).get("price_aud"),
        }
        for i, pf in enumerate(row.pop("package_flights", []) or [])
    ]
    package_hotels = row.pop("package_hotels", []) or []
    row["hotels"] = [
        {
            "hotel_id": ph.get("hotel_id"),
            "sequence_order": i + 1,
            "hotel_name": (ph.get("hotels") or {}).get("hotel_name"),
            "star_rating": (ph.get("hotels") or {}).get("star_rating"),
            "city": (ph.get("hotels") or {}).get("city"),
            "address": (ph.get("hotels") or {}).get("address"),
            "check_in_date": ph.get("check_in_date"),
            "check_out_date": ph.get("check_out_date"),
            "price_per_night_aud": (ph.get("hotels") or {}).get("price_per_night_aud"),
            "room_type": (ph.get("hotels") or {}).get("room_type"),
        }
        for i, ph in enumerate(package_hotels)
    ]
    row["activities"] = [
        {
            "activity_id": pa.get("activity_id"),
            "sequence_order": pa.get("sequence_order") or i + 1,
            "activity_name": (pa.get("activities") or {}).get("activity_name"),
            "activity_date": pa.get("activity_date"),
            "city": (pa.get("activities") or {}).get("city"),
            "duration_hours": (pa.get("activities") or {}).get("duration_hours"),
            "price_aud": (pa.get("activities") or {}).get("price_aud"),
            "description": (pa.get("activities") or {}).get("description"),
            "booking_required": (pa.get("activities") or {}).get("booking_required"),
        }
        for i, pa in enumerate(row.pop("package_activities", []) or [])
    ]
    # Informational breakdown from catalog prices; null prices count as 0.
    # base_price_aud stays the creator-set display price — the API asserts
    # nothing about which total is "the" price.
    flights_total = sum(f["price_aud"] or 0 for f in row["flights"])
    hotels_total = sum(
        ((ph.get("hotels") or {}).get("price_per_night_aud") or 0)
        * (ph.get("nights") or 0)
        for ph in package_hotels
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


def create_package(uid, headers, payload):
    # ponytail: catalog tables are SELECT-only under RLS by design; the service
    # role is the only write path.
    admin = _admin_headers()
    rep = {"Prefer": "return=representation"}

    flights = [
        {
            "flight_id": str(uuid4()),
            "airline": f.airline,
            "flight_number": f.flight_number,
            "origin": f.origin_iata,
            "destination": f.destination_iata,
            "departure_datetime": f.departure_datetime,
            "arrival_datetime": f.arrival_datetime,
            "cabin_class": f.cabin_class,
            "price_aud": f.price_aud or 0,
        }
        for f in payload.flights
    ]
    hotels = [
        {
            "hotel_id": str(uuid4()),
            "hotel_name": h.hotel_name,
            "city": h.city,
            "country": payload.destination_country,
            "star_rating": h.star_rating,
            "room_type": h.room_type,
            "address": h.address,
            "price_per_night_aud": h.price_per_night_aud or 0,
        }
        for h in payload.hotels
    ]
    activities = [
        {
            "activity_id": str(uuid4()),
            "activity_name": a.activity_name,
            "city": a.city,
            "country": payload.destination_country,
            "price_aud": a.price_aud or 0,
            "duration_hours": a.duration_hours,
            "description": a.description,
            "booking_required": a.booking_required,
        }
        for a in payload.activities
    ]
    package = _call(
        "post",
        "travel_packages",
        json={
            "title": payload.title,
            "description": payload.description,
            "destination_country": payload.destination_country,
            "destination_city": payload.destination_city,
            "duration_days": payload.duration_days,
            "base_price_aud": payload.base_price_aud,
            "max_group_size": payload.max_group_size,
            "tags": payload.tags,
            "creator_id": uid,
        },
        headers={**headers, **rep},
    ).json()[0]
    package_id = package["package_id"]

    # ponytail: sequential inserts with best-effort rollback; move to an RPC
    # transaction if partial drafts ever bite.
    created_catalog = []
    try:
        for table, key, rows in (
            ("flights", "flight_id", flights),
            ("hotels", "hotel_id", hotels),
            ("activities", "activity_id", activities),
        ):
            if rows:
                _call("post", table, json=rows, headers=admin)
                created_catalog.append((table, key, [r[key] for r in rows]))
        if flights:
            _call(
                "post",
                "package_flights",
                json=[
                    {
                        "package_id": package_id,
                        "flight_id": row["flight_id"],
                        "sequence_order": i + 1,
                    }
                    for i, row in enumerate(flights)
                ],
                headers=headers,
            )
        if hotels:
            _call(
                "post",
                "package_hotels",
                json=[
                    {
                        "package_id": package_id,
                        "hotel_id": row["hotel_id"],
                        "check_in_date": h.check_in_date.isoformat(),
                        "check_out_date": h.check_out_date.isoformat(),
                        "nights": (h.check_out_date - h.check_in_date).days,
                    }
                    for row, h in zip(hotels, payload.hotels)
                ],
                headers=headers,
            )
        if activities:
            _call(
                "post",
                "package_activities",
                json=[
                    {
                        "package_id": package_id,
                        "activity_id": row["activity_id"],
                        "activity_date": a.activity_date.isoformat(),
                        "sequence_order": i + 1,
                    }
                    for i, (row, a) in enumerate(zip(activities, payload.activities))
                ],
                headers=headers,
            )
        return get_package_detail(package_id, headers, uid)
    except UpstreamError:
        try:
            _call(
                "delete",
                "travel_packages",
                params={"package_id": f"eq.{package_id}"},
                headers=headers,
            )
        except UpstreamError:
            pass
        for table, key, ids in created_catalog:
            try:
                _call(
                    "delete",
                    table,
                    params={key: f"in.({','.join(ids)})"},
                    headers=admin,
                )
            except UpstreamError:
                pass
        raise


def update_package(package_id, headers, uid, payload):
    body = payload.model_dump(exclude_unset=True)
    body["updated_at"] = _now()
    rows = _call(
        "patch",
        "travel_packages",
        params={"package_id": f"eq.{package_id}", "status": "in.(draft,rejected)"},
        json=body,
        headers={**headers, "Prefer": "return=representation"},
    ).json()
    if not rows:
        current = _call(
            "get",
            "travel_packages",
            params={"package_id": f"eq.{package_id}", "select": "status"},
            headers=headers,
        ).json()
        if not current:
            return "not_found", None
        return "not_editable", current[0].get("status")
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


def submit_package(package_id, headers, note):
    rows = _call(
        "get",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "select": (
                "package_id,status,base_price_aud,package_flights(flight_id),"
                "package_hotels(hotel_id),package_activities(activity_id)"
            ),
        },
        headers=headers,
    ).json()
    if not rows:
        return "not_found", None
    row = rows[0]

    failures = []
    details = {}
    status = row.get("status")
    if status not in {"draft", "rejected"}:
        failures.append(
            f"Package status is '{status}'; only 'draft' or 'rejected' "
            "packages may be submitted."
        )
    missing = [
        name
        for name, key in (
            ("flight", "package_flights"),
            ("hotel", "package_hotels"),
            ("activity", "package_activities"),
        )
        if not (row.get(key) or [])
    ]
    if missing:
        failures.append(
            "Package must have at least one " + ", ".join(missing) + "."
        )
        details["missing"] = missing
    if (row.get("base_price_aud") or 0) <= 0:
        failures.append("base_price_aud must be greater than 0.")
    if failures:
        details["failures"] = failures
        return "precondition_failed", details

    now = _now()
    updated = _call(
        "patch",
        "travel_packages",
        params={
            "package_id": f"eq.{package_id}",
            "status": "in.(draft,rejected)",
            "select": _SUMMARY_SELECT + ",package_media(url,is_cover)",
            "package_media.order": "is_cover.desc,sort_order.asc",
        },
        json={
            "status": "pending_review",
            "submitted_at": now,
            "submission_note": note,
            "updated_at": now,
        },
        headers={**headers, "Prefer": "return=representation"},
    ).json()
    if not updated:
        return "not_found", None
    summary = updated[0]
    summary["cover_image_url"] = _cover_url(summary.pop("package_media", []))
    return "ok", summary
