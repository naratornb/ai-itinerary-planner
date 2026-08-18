from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException

from app.auth.router import router as auth_router
from app.approvals.router import router as approvals_router
from app.core import _err
from app.marketplace.router import router as marketplace_router
from app.packages.router import router as packages_router
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


# Every error response shares the ErrorResponse shape from openapi.yaml.
_STATUS_CODES = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND"}


@app.exception_handler(RequestValidationError)
def validation_error_handler(_request: Request, exc: RequestValidationError):
    return _err(
        422,
        "VALIDATION_ERROR",
        "One or more fields are invalid.",
        # errors() can carry non-JSON ctx values (raw exceptions) in Pydantic v2.
        {"errors": jsonable_encoder(exc.errors())},
    )


@app.exception_handler(HTTPException)
def http_exception_handler(_request: Request, exc: HTTPException):
    return _err(
        exc.status_code,
        _STATUS_CODES.get(exc.status_code, "ERROR"),
        str(exc.detail),
    )


app.include_router(auth_router, tags=["auth"])
app.include_router(approvals_router, tags=["approvals"])
app.include_router(marketplace_router, tags=["marketplace"])
app.include_router(packages_router, tags=["packages"])
app.include_router(users_router, tags=["users"])
