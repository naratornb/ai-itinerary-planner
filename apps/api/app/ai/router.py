import logging
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Query

from app.ai import service
from app.ai.engine import generate_itinerary
from app.ai.schemas import (
    AISuggestion,
    AISuggestionAcceptRequest,
    AISuggestionAcceptResponse,
    AISuggestionListResponse,
    AISuggestRequest,
    Itinerary,
    RecommendRequest,
)
from app.core import _err, require_user_ctx

router = APIRouter()

logger = logging.getLogger(__name__)

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


@router.post("/ai/recommend", response_model=Itinerary)
def recommend(payload: RecommendRequest):
    """Plain `def` on purpose: generate_itinerary() blocks on Supabase and
    Gemini, so FastAPI runs it in a threadpool instead of the event loop."""
    try:
        return generate_itinerary(payload.query, origin_city=payload.origin_city)
    except EnvironmentError:
        error_id = uuid4().hex[:8]
        logger.exception("Itinerary engine is misconfigured [error_id=%s]", error_id)
        return _err(
            500, "CONFIG_ERROR", "AI service is not configured.", {"error_id": error_id}
        )
    except Exception as exc:  # noqa: BLE001 — engine raises bare Exception
        # The exception text can carry provider payloads, so it goes to the
        # logs only. error_id is the client's handle for finding that line.
        error_id = uuid4().hex[:8]
        logger.exception("Itinerary generation failed [error_id=%s]", error_id)
        if "429" in str(exc) or "quota" in str(exc).lower():
            return _err(
                429,
                "RATE_LIMITED",
                "AI provider quota exceeded.",
                {"error_id": error_id},
            )
        return _err(
            502, "LLM_FAILURE", "AI provider request failed.", {"error_id": error_id}
        )


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
