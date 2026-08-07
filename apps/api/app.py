import os
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

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
