import os
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import Header, HTTPException
from fastapi.responses import JSONResponse

# Loaded here (not main.py) because these module-level env reads run first.
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

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


def _err(status_code, error_code, message, details=None):
    """The one ErrorResponse shape from openapi.yaml."""
    body = {"error_code": error_code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse(body, status_code=status_code)


def require_user_ctx(authorization: str = Header(default="")):
    """require_user plus the PostgREST headers that act as that user (RLS)."""
    if not SUPABASE_ANON_KEY:
        raise HTTPException(500, "Supabase anon credentials not configured.")
    user = require_user(authorization)
    return {
        "uid": user["id"],
        "headers": {"apikey": SUPABASE_ANON_KEY, "Authorization": authorization},
    }
