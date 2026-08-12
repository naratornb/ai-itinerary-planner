import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import core

router = APIRouter()

# Nested PostgREST embed for the marketplace detail page. Ordering is
# done by PostgREST (order= params), not in Python. influencer_profiles
# hangs off profiles, not the package, hence the nesting.
_DETAIL_SELECT = (
    "*,"
    "creator:profiles!creator_id(full_name,avatar_url,"
    "influencer_profiles(bio,social_handle,follower_count,verified)),"
    "package_media(*),package_days(*),"
    "package_flights(*,flights(*)),"
    "package_hotels(*,hotels(*)),"
    "package_activities(*,activities(*))"
)


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
