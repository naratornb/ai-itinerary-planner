import time
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from fastapi.responses import JSONResponse

from app import core
from app.copilot import service
from app.copilot.schemas import (
    FeedbackInput,
    PromptInput,
    Suggestion,
    TurnList,
    TurnRead,
)
from app.packages.service import UpstreamError

router = APIRouter(prefix="/ai/copilot")


def require_copilot_ctx(authorization: str = Header(default="")) -> dict:
    started = time.monotonic()
    if not core.SUPABASE_ANON_KEY:
        raise HTTPException(500, "Supabase credentials not configured.")
    user = core.validate_user(authorization, timeout=2)
    return {
        "uid": user["id"],
        "headers": {"apikey": core.SUPABASE_ANON_KEY, "Authorization": authorization},
        "started": started,
        "deadline": started + 10,
    }


def error(exc: UpstreamError) -> JSONResponse:
    code = {404: "NOT_FOUND", 409: "SUGGESTION_ALREADY_RESOLVED"}.get(
        exc.status_code, "UPSTREAM_ERROR"
    )
    return core._err(exc.status_code, code, exc.message)


@router.post("/{package_id}/turns", status_code=201, response_model=TurnRead)
def create_turn(
    package_id: UUID, body: PromptInput, ctx: dict = Depends(require_copilot_ctx)
) -> TurnRead | JSONResponse:
    try:
        return service.create_turn(str(package_id), body.prompt, ctx)
    except UpstreamError as exc:
        return error(exc)


@router.get("/{package_id}/turns", status_code=200, response_model=TurnList)
def list_turns(
    package_id: UUID,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    ctx: dict = Depends(require_copilot_ctx),
) -> TurnList | JSONResponse:
    try:
        return service.list_turns(str(package_id), ctx, page, per_page)
    except UpstreamError as exc:
        return error(exc)


@router.patch(
    "/{package_id}/turns/{turn_id}/items/{item_id}",
    status_code=200,
    response_model=Suggestion,
)
def feedback(
    package_id: UUID,
    turn_id: UUID,
    item_id: str,
    body: FeedbackInput,
    ctx: dict = Depends(require_copilot_ctx),
) -> Suggestion | JSONResponse:
    try:
        return service.feedback(
            str(package_id), str(turn_id), item_id, body.status, ctx
        )
    except UpstreamError as exc:
        return error(exc)
