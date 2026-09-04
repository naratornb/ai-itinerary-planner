from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from app.ai import service
from app.ai.schemas import (
    AISuggestion,
    AISuggestionAcceptRequest,
    AISuggestionAcceptResponse,
    AISuggestionListResponse,
    AISuggestRequest,
)
from app.core import _err, require_user_ctx

router = APIRouter()

SuggestionStatus = Literal["pending", "accepted", "dismissed"]


def _upstream(exc: service.UpstreamError):
    return _err(exc.status_code, "UPSTREAM_ERROR", exc.message)


def _resolved(status):
    return _err(
        409,
        "SUGGESTION_ALREADY_RESOLVED",
        f"This suggestion has already been {status}.",
    )


@router.post("/ai/suggest", status_code=201, response_model=AISuggestion)
def generate_suggestion(
    payload: AISuggestRequest, ctx: dict = Depends(require_user_ctx)
):
    try:
        outcome, result = service.create_suggestion(
            ctx["headers"], ctx["uid"], payload.package_id, payload.prompt
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _err(404, "NOT_FOUND", "Package not found.")
    return result


@router.get("/ai/suggestions/{package_id}", response_model=AISuggestionListResponse)
def list_suggestions(
    package_id: str,
    status: Optional[SuggestionStatus] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    ctx: dict = Depends(require_user_ctx),
):
    try:
        outcome, rows, meta = service.list_suggestions(
            ctx["headers"], ctx["uid"], package_id, status, page, per_page
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _err(404, "NOT_FOUND", "Package not found.")
    return {"data": rows, "meta": meta}


@router.patch(
    "/ai/suggestions/{suggestion_id}/accept",
    response_model=AISuggestionAcceptResponse,
)
def accept_suggestion(
    suggestion_id: str,
    body: AISuggestionAcceptRequest | None = None,
    ctx: dict = Depends(require_user_ctx),
):
    try:
        outcome, result = service.accept_suggestion(
            ctx["headers"], ctx["uid"], suggestion_id,
            body.auto_apply if body else True,
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _err(404, "NOT_FOUND", "Suggestion not found.")
    if outcome == "already_resolved":
        return _resolved(result)
    return result


@router.patch("/ai/suggestions/{suggestion_id}/dismiss", response_model=AISuggestion)
def dismiss_suggestion(suggestion_id: str, ctx: dict = Depends(require_user_ctx)):
    try:
        outcome, result = service.dismiss_suggestion(ctx["headers"], suggestion_id)
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _err(404, "NOT_FOUND", "Suggestion not found.")
    if outcome == "already_resolved":
        return _resolved(result)
    return result
