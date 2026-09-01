import logging
from math import ceil

import requests
from requests import RequestException

from app import core
from app.packages.service import UpstreamError, _cover_url

logger = logging.getLogger(__name__)

# Every PostgREST call for the marketplace listing/search lives here, so tests
# only have to stub `app.marketplace.service.requests`.

_LIST_SELECT = (
    "package_id,title,destination_country,destination_city,duration_days,"
    "base_price_aud,tags,published_at,"
    "creator:profiles!creator_id(full_name,"
    "influencer_profiles(instagram_handle,follower_count)),"
    "package_media(url,is_cover,sort_order)"
)

SORT_MAP = {
    "published_at_desc": "published_at.desc",
    "price_asc": "base_price_aud.asc",
    "price_desc": "base_price_aud.desc",
    "duration_asc": "duration_days.asc",
}


def _anon_headers():
    return {
        "apikey": core.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {core.SUPABASE_ANON_KEY}",
    }


def _call(method: str, path: str, **kwargs):
    try:
        response = getattr(requests, method)(
            f"{core.SUPABASE_URL}/rest/v1/{path}", timeout=15, **kwargs
        )
    except RequestException:
        raise UpstreamError(503, "Database unreachable.")
    if not response.ok:
        logger.error(
            "PostgREST %s %s failed (%s): %s",
            method, path, response.status_code, response.text,
        )
        raise UpstreamError(502, "Upstream database error.")
    return response


def _influencer(row):
    creator = row.get("creator") or {}
    profile = creator.get("influencer_profiles")
    if isinstance(profile, list):
        profile = profile[0] if profile else None
    profile = profile or {}
    return {
        "display_name": creator.get("full_name"),
        "instagram_handle": profile.get("instagram_handle"),
        "follower_count": profile.get("follower_count"),
    }


def _to_summary(row):
    return {
        "package_id": row.get("package_id"),
        "title": row.get("title"),
        "destination_country": row.get("destination_country"),
        "destination_city": row.get("destination_city"),
        "duration_days": row.get("duration_days"),
        "base_price_aud": row.get("base_price_aud"),
        "cover_image_url": _cover_url(row.get("package_media") or []),
        "tags": row.get("tags") or [],
        "influencer": _influencer(row),
        "published_at": row.get("published_at"),
    }


def _meta(total, page, per_page):
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": ceil(total / per_page) if total else 0,
    }


def _tag_list(tags):
    return [t.strip() for t in tags.split(",") if t.strip()] if tags else []


def list_marketplace(
    page, per_page, destination_country, destination_city,
    min_price_aud, max_price_aud, min_nights, max_nights, tags, sort,
):
    params = {
        "status": "eq.live",
        "select": _LIST_SELECT,
        "package_media.order": "is_cover.desc,sort_order.asc",
        "order": SORT_MAP[sort],
        "limit": per_page,
        "offset": (page - 1) * per_page,
    }
    if destination_country:
        params["destination_country"] = f"ilike.*{destination_country}*"
    if destination_city:
        params["destination_city"] = f"ilike.*{destination_city}*"
    if min_price_aud is not None:
        params["base_price_aud"] = f"gte.{min_price_aud}"
    if max_price_aud is not None:
        # PostgREST takes repeated keys for a range; requests needs a list.
        existing = params.get("base_price_aud")
        value = f"lte.{max_price_aud}"
        params["base_price_aud"] = [existing, value] if existing else value
    if min_nights is not None:
        params["duration_days"] = f"gte.{min_nights}"
    if max_nights is not None:
        existing = params.get("duration_days")
        value = f"lte.{max_nights}"
        params["duration_days"] = [existing, value] if existing else value
    tag_list = _tag_list(tags)
    if tag_list:
        params["tags"] = "ov.{" + ",".join(tag_list) + "}"

    response = _call(
        "get", "travel_packages", params=params,
        headers={**_anon_headers(), "Prefer": "count=exact"},
    )
    content_range = response.headers.get("Content-Range", "") if response.headers else ""
    tail = content_range.rsplit("/", 1)[-1]
    total = int(tail) if tail.isdigit() else 0
    return [_to_summary(r) for r in response.json()], _meta(total, page, per_page)


def search(q, page, per_page, destination_country, min_price_aud, max_price_aud, tags):
    body = {
        "q": q,
        "dest_country": destination_country,
        "min_price": min_price_aud,
        "max_price": max_price_aud,
        "filter_tags": _tag_list(tags) or None,
        "page": page,
        "per_page": per_page,
    }
    rows = _call(
        "post", "rpc/search_packages",
        json={k: v for k, v in body.items() if v is not None},
        headers=_anon_headers(),
    ).json()
    total = rows[0].get("total_count") or 0 if rows else 0
    if not rows:
        return [], _meta(0, page, per_page)

    ids = ",".join(r["package_id"] for r in rows)
    detail = _call(
        "get", "travel_packages",
        params={
            "package_id": f"in.({ids})",
            "select": _LIST_SELECT,
            "package_media.order": "is_cover.desc,sort_order.asc",
        },
        headers=_anon_headers(),
    ).json()
    by_id = {d["package_id"]: d for d in detail}

    results = []
    for row in rows:  # RPC order is the relevance order; preserve it.
        summary = _to_summary({**row, **by_id.get(row["package_id"], {})})
        summary["relevance_score"] = row.get("relevance_score")
        results.append(summary)
    return results, _meta(total, page, per_page)
