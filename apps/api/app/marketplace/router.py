from typing import Literal

import requests
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app import core
from app.core import _err
from app.marketplace import schemas, service
from app.packages.service import _DETAIL_SELECT, UpstreamError

router = APIRouter()

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

@router.get("/marketplace/packages", response_model=schemas.MarketplaceListResponse)
def list_marketplace_packages(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    destination_country: str | None = None,
    destination_city: str | None = None,
    min_price_aud: int | None = Query(None, ge=0),
    max_price_aud: int | None = Query(None, ge=0),
    min_nights: int | None = Query(None, ge=1),
    max_nights: int | None = Query(None, ge=1),
    tags: str | None = None,
    sort: Literal[
        "published_at_desc", "price_asc", "price_desc", "duration_asc"
    ] = "published_at_desc",
):
    """Public marketplace browse. RLS limits anon visibility to live rows."""
    try:
        data, meta = service.list_marketplace(
            page, per_page, destination_country, destination_city,
            min_price_aud, max_price_aud, min_nights, max_nights, tags, sort,
        )
    except UpstreamError as exc:
        return _err(exc.status_code, "UPSTREAM_ERROR", exc.message)
    return {"data": data, "meta": meta}


@router.get("/marketplace/search", response_model=schemas.MarketplaceSearchResponse)
def search_marketplace(
    q: str = Query(...),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    destination_country: str | None = None,
    min_price_aud: int | None = Query(None, ge=0),
    max_price_aud: int | None = Query(None, ge=0),
    tags: str | None = None,
):
    """Full-text search via the search_packages RPC, ranked by relevance."""
    # Contract wants 400, not FastAPI's 422, hence the manual length check.
    if not q or not (2 <= len(q) <= 200):
        return _err(
            400,
            "SEARCH_QUERY_TOO_SHORT",
            "The search query must be at least 2 characters long.",
        )
    try:
        data, meta = service.search(
            q, page, per_page, destination_country,
            min_price_aud, max_price_aud, tags,
        )
    except UpstreamError as exc:
        return _err(exc.status_code, "UPSTREAM_ERROR", exc.message)
    return {"query": q, "data": data, "meta": meta}


@router.get("/marketplace/packages/{package_id}")
def get_marketplace_package(package_id: str):
    """Public package detail. The anon key + RLS restrict visibility to
    live packages, so drafts are indistinguishable from nonexistent."""
    if not core.SUPABASE_URL or not core.SUPABASE_ANON_KEY:
        raise HTTPException(500, "Supabase anon credentials not configured.")
    try:
        response = requests.get(
            f"{core.SUPABASE_URL}/rest/v1/travel_packages",
            params={
                "package_id": f"eq.{package_id}",
                "select": _DETAIL_SELECT,
                "package_media.order": "is_cover.desc,sort_order.asc",
                "package_days.order": "day_number.asc",
                "package_flights.order": "day_number.asc,sequence_order.asc",
                "package_activities.order": "day_number.asc,sequence_order.asc",
            },
            headers={
                "apikey": core.SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {core.SUPABASE_ANON_KEY}",
            },
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(503, "Database unreachable.")
    if not response.ok:
        return JSONResponse({"error": response.text}, status_code=response.status_code)

    rows = response.json()
    if not rows:
        return JSONResponse(
            {"error_code": "PACKAGE_NOT_FOUND", "message": "Package not found."},
            status_code=404,
        )
    package = rows[0]
    package["media"] = package.pop("package_media", [])
    package["days"] = package.pop("package_days", [])
    package["flights"] = package.pop("package_flights", [])
    package["hotels"] = package.pop("package_hotels", [])
    package["activities"] = package.pop("package_activities", [])
    return package
