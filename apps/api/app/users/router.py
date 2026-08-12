import requests
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import core
from app.core import require_user

router = APIRouter()


class UserUpdate(BaseModel):
    email: str | None = None
    status: str | None = None
    createdAt: str | None = None


@router.get("/users")
def list_users(_user: dict = Depends(require_user)):
    response = requests.get(
        f"{core.SUPABASE_URL}/auth/v1/admin/users",
        headers=core._admin_headers(),
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


@router.patch("/users/{user_id}")
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
        f"{core.SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={"Content-Type": "application/json", **core._admin_headers()},
        json=update_payload,
        timeout=15,
    )

    if not response.ok:
        return JSONResponse({"error": response.text}, status_code=response.status_code)

    return response.json()
