import os

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def _admin_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/users")
def list_users():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return jsonify({"error": "Supabase admin credentials not configured."}), 500

    response = requests.get(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=_admin_headers(),
        timeout=15,
    )
    if not response.ok:
        return jsonify({"error": response.text}), response.status_code

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

    return jsonify({"users": normalized})


@app.patch("/users/<user_id>")
def update_user(user_id: str):
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return jsonify({"error": "Supabase admin credentials not configured."}), 500

    payload = request.get_json(silent=True) or {}
    update_payload = {}

    email = payload.get("email")
    if email:
        update_payload["email"] = email

    status = payload.get("status")
    created_at = payload.get("createdAt")
    user_metadata = {}
    app_metadata = {}
    if status:
        app_metadata["status"] = status
    if created_at:
        user_metadata["createdAt"] = created_at

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
        return jsonify({"error": response.text}), response.status_code

    return jsonify(response.json())


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
