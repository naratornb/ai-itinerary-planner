import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Response

from app import core
from app.auth.schemas import LoginRequest, LoginResponse, UserProfile
from app.core import _err, require_user

router = APIRouter()

_PROFILE_SELECT = (
    "full_name,role,created_at,"
    "influencer_profiles(bio,instagram_handle,tiktok_handle,follower_count,verified)"
)


def _require_anon_config():
    if not core.SUPABASE_URL or not core.SUPABASE_ANON_KEY:
        raise HTTPException(500, "Supabase anon credentials not configured.")


def _user_profile(user_json, headers):
    """UserProfile dict for an auth user, or None when the profile row is gone."""
    try:
        response = requests.get(
            f"{core.SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{user_json['id']}", "select": _PROFILE_SELECT},
            headers=headers,
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(503, "Database unreachable.")
    if not response.ok:
        raise HTTPException(503, "Database unreachable.")
    rows = response.json()
    if not rows:
        return None
    row = rows[0]

    influencer = None
    if row.get("role") == "influencer":
        # PostgREST returns the embed as a list or an object depending on cardinality.
        embed = row.get("influencer_profiles")
        if isinstance(embed, list):
            embed = embed[0] if embed else None
        influencer = embed

    return {
        "user_id": user_json["id"],
        "email": user_json.get("email"),
        "display_name": row.get("full_name"),
        "role": row.get("role"),
        "created_at": row.get("created_at"),
        "influencer_profile": influencer,
    }


@router.post("/auth/login", status_code=200, response_model=LoginResponse)
def login(body: LoginRequest):
    # TODO:: rate-limit this public credential endpoint (AGENTS.md security rule);
    # needs an infra-level or slowapi limiter — deferred with human sign-off.
    _require_anon_config()
    try:
        response = requests.post(
            f"{core.SUPABASE_URL}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": core.SUPABASE_ANON_KEY},
            json={"email": body.email, "password": body.password},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(503, "Auth service unreachable.")
    if not response.ok:
        return _err(401, "INVALID_CREDENTIALS", "Invalid email or password.")

    payload = response.json()
    token = payload.get("access_token")
    if not token or not payload.get("user"):
        # e.g. an MFA challenge — a 200 without a usable session.
        return _err(401, "INVALID_CREDENTIALS", "Invalid email or password.")
    profile = _user_profile(
        payload["user"],
        {"apikey": core.SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
    )
    if profile is None:
        return _err(404, "NOT_FOUND", "Profile not found.")
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": payload.get("expires_in"),
        "user": profile,
    }


@router.get("/auth/me", response_model=UserProfile)
def get_me(user: dict = Depends(require_user), authorization: str = Header(default="")):
    _require_anon_config()
    profile = _user_profile(
        user,
        {"apikey": core.SUPABASE_ANON_KEY, "Authorization": authorization},
    )
    if profile is None:
        return _err(404, "NOT_FOUND", "Profile not found.")
    return profile


@router.post("/auth/logout", status_code=204)
def logout(authorization: str = Header(default="")):
    # TODO:: spec asks for a server-side access-token deny-list; Supabase only
    # revokes the refresh token here.
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token.")
    _require_anon_config()
    try:
        response = requests.post(
            f"{core.SUPABASE_URL}/auth/v1/logout",
            headers={"apikey": core.SUPABASE_ANON_KEY, "Authorization": authorization},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(503, "Auth service unreachable.")
    if response.status_code == 401:
        return _err(401, "UNAUTHORIZED", "Invalid or expired token.")
    if not response.ok:
        return _err(502, "UPSTREAM_ERROR", "Auth service error during logout.")
    return Response(status_code=204)
