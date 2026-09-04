from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.approvals import service
from app.approvals.schemas import (
    ApprovalListResponse,
    ApproveRequest,
    DecisionResponse,
    RejectRequest,
)
from app.core import _err, require_admin_ctx, require_user_ctx
from app.packages.schemas import TravelPackageSummary

router = APIRouter()


def _upstream(exc: service.UpstreamError):
    return _err(exc.status_code, "UPSTREAM_ERROR", exc.message)


def _not_found():
    return _err(404, "NOT_FOUND", "Package not found.")


def _invalid_status(verb, current, required):
    return _err(
        409,
        "INVALID_STATUS_TRANSITION",
        f"Cannot {verb} a package in status '{current}'; it must be '{required}'.",
    )


@router.get("/approvals", response_model=ApprovalListResponse)
def list_pending_approvals(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    sort: Literal["submitted_at_asc", "submitted_at_desc"] = "submitted_at_asc",
    ctx: dict = Depends(require_admin_ctx),
):
    try:
        rows, meta = service.list_pending(ctx["headers"], page, per_page, sort)
    except service.UpstreamError as exc:
        return _upstream(exc)
    return {"data": rows, "meta": meta}


@router.post("/approvals/{package_id}/approve", response_model=DecisionResponse)
def approve_package(
    package_id: str,
    body: ApproveRequest | None = None,
    ctx: dict = Depends(require_admin_ctx),
):
    try:
        outcome, result = service.decide(
            package_id, ctx, "approved", notes=body.notes if body else None
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _not_found()
    if outcome == "invalid_status":
        return _invalid_status("approve", result, "pending_review")
    return result


@router.post("/approvals/{package_id}/reject", response_model=DecisionResponse)
def reject_package(
    package_id: str,
    body: RejectRequest,
    ctx: dict = Depends(require_admin_ctx),
):
    try:
        outcome, result = service.decide(
            package_id,
            ctx,
            "rejected",
            rejection_reason=body.rejection_reason,
            notes=body.notes,
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _not_found()
    if outcome == "invalid_status":
        return _invalid_status("reject", result, "pending_review")
    return result


@router.post("/approvals/{package_id}/publish", response_model=TravelPackageSummary)
def publish_package(package_id: str, ctx: dict = Depends(require_user_ctx)):
    """Owners self-publish; RLS enforces ownership (non-owners read as 404)."""
    try:
        outcome, result = service.publish(package_id, ctx["headers"])
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _not_found()
    if outcome == "invalid_status":
        return _invalid_status("publish", result, "approved")
    return result
