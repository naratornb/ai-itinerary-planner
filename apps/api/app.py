import os
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

OPENAPI_SPEC = Path(__file__).resolve().parent / "openapi.yaml"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    # localhost dev + Vercel previews/production
    allow_origin_regex=r"^https?://(localhost:3000|.*\.vercel\.app)$",
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
# Anon key is public by design; reuse the web app's env var.
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY", ""
)


def _admin_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }


def _require_config():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(500, "Supabase admin credentials not configured.")


def require_user(authorization: str = Header(default="")):
    """Validate the caller's Supabase access token before exposing admin routes."""
    _require_config()
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token.")
    try:
        response = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": authorization,
            },
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(503, "Auth service unreachable.")
    if not response.ok:
        raise HTTPException(401, "Invalid or expired token.")
    return response.json()


class UserUpdate(BaseModel):
    email: str | None = None
    status: str | None = None
    createdAt: str | None = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/openapi.yaml", include_in_schema=False)
def openapi_spec():
    return FileResponse(OPENAPI_SPEC, media_type="application/yaml")


@app.get("/docs-ui", include_in_schema=False)
def docs_ui():
    # Renders the canonical contract (openapi.yaml), unlike /docs
    # which documents the live FastAPI routes.
    return get_swagger_ui_html(openapi_url="/openapi.yaml", title="API contract")


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


@app.get("/marketplace/packages/{package_id}")
def get_marketplace_package(package_id: str):
    """Public package detail. The anon key + RLS restrict visibility to
    live packages, so drafts are indistinguishable from nonexistent."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(500, "Supabase anon credentials not configured.")
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/travel_packages",
            params={
                "package_id": f"eq.{package_id}",
                "select": _DETAIL_SELECT,
                "package_media.order": "is_cover.desc,sort_order.asc",
                "package_days.order": "day_number.asc",
                "package_flights.order": "day_number.asc,sequence_order.asc",
                "package_activities.order": "day_number.asc,sequence_order.asc",
            },
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
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


@app.get("/users")
def list_users(_user: dict = Depends(require_user)):
    response = requests.get(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=_admin_headers(),
        timeout=15,
    )
    if not response.ok:
        return JSONResponse({"error": response.text}, status_code=response.status_code)

    payload = response.json()
    users = payload.get("users", []) if isinstance(payload, dict) else payload
    normalized = []
    for user in users:
        email = user.get("email") or ""
        user_metadata = user.get("user_metadata") or {}
        app_metadata = user.get("app_metadata") or {}
        normalized.append(
            {
                "id": user.get("id"),
                "email": email,
                "createdAt": user_metadata.get("createdAt") or user.get("created_at"),
                "status": app_metadata.get("status", "active"),
                "role": app_metadata.get("role", "member"),
                "username": user_metadata.get("username") or email.split("@")[0],
            }
        )

    return {"users": normalized}


@app.patch("/users/{user_id}")
def update_user(user_id: str, payload: UserUpdate, _user: dict = Depends(require_user)):
    update_payload = {}
    if payload.email:
        update_payload["email"] = payload.email

    user_metadata = {}
    app_metadata = {}
    if payload.status:
        app_metadata["status"] = payload.status
    if payload.createdAt:
        user_metadata["createdAt"] = payload.createdAt

    if app_metadata:
        update_payload["app_metadata"] = app_metadata
    if user_metadata:
        update_payload["user_metadata"] = user_metadata

    response = requests.put(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={"Content-Type": "application/json", **_admin_headers()},
        json=update_payload,
        timeout=15,
    )

    if not response.ok:
        return JSONResponse({"error": response.text}, status_code=response.status_code)

    return response.json()
