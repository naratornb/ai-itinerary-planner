from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse

from app.marketplace.router import router as marketplace_router
from app.users.router import router as users_router

OPENAPI_SPEC = Path(__file__).resolve().parents[1] / "openapi.yaml"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    # localhost dev + Vercel previews/production
    allow_origin_regex=r"^https?://(localhost:3000|.*\.vercel\.app)$",
    allow_methods=["*"],
    allow_headers=["*"],
)


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


app.include_router(marketplace_router, tags=["marketplace"])
app.include_router(users_router, tags=["users"])
