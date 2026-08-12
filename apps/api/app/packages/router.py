from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Response

from app.core import _err, require_user_ctx
from app.packages import service
from app.packages.schemas import (
    PackageListResponse,
    SubmitBody,
    TravelPackageCreate,
    TravelPackageDetail,
    TravelPackageSummary,
    TravelPackageUpdate,
)

router = APIRouter()

PackageStatus = Literal[
    "draft", "pending_review", "approved", "rejected", "live", "archived"
]


def _upstream(exc: service.UpstreamError):
    return _err(exc.status_code, "UPSTREAM_ERROR", exc.message)


def _not_found():
    return _err(404, "NOT_FOUND", "Package not found.")


@router.get("/packages", response_model=PackageListResponse)
def list_packages(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: Optional[PackageStatus] = None,
    sort: Literal[
        "created_at_desc", "created_at_asc", "price_asc", "price_desc"
    ] = "created_at_desc",
    ctx: dict = Depends(require_user_ctx),
):
    """Own packages (all statuses); RLS decides whose rows come back."""
    try:
        rows, meta = service.list_packages(
            ctx["headers"], ctx["uid"], page, per_page, status, sort
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    return {"data": rows, "meta": meta}


@router.post("/packages", status_code=201, response_model=TravelPackageDetail)
def create_package(
    payload: TravelPackageCreate, ctx: dict = Depends(require_user_ctx)
):
    try:
        return service.create_package(ctx["uid"], ctx["headers"], payload)
    except service.UpstreamError as exc:
        return _upstream(exc)


@router.get("/packages/{package_id}", response_model=TravelPackageDetail)
def get_package(package_id: str, ctx: dict = Depends(require_user_ctx)):
    try:
        package = service.get_package_detail(package_id, ctx["headers"], ctx["uid"])
    except service.UpstreamError as exc:
        return _upstream(exc)
    return package if package else _not_found()


@router.put("/packages/{package_id}", response_model=TravelPackageDetail)
def update_package(
    package_id: str,
    payload: TravelPackageUpdate,
    ctx: dict = Depends(require_user_ctx),
):
    try:
        outcome, result = service.update_package(
            package_id, ctx["headers"], ctx["uid"], payload
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _not_found()
    if outcome == "not_editable":
        return _err(
            409,
            "PACKAGE_NOT_EDITABLE",
            f"This package cannot be edited because its status is '{result}'. "
            "Only packages in 'draft' or 'rejected' status may be updated.",
        )
    return result


@router.delete("/packages/{package_id}", status_code=204)
def delete_package(package_id: str, ctx: dict = Depends(require_user_ctx)):
    try:
        outcome, _status = service.delete_package(package_id, ctx["headers"])
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _not_found()
    if outcome == "not_deletable":
        return _err(
            409,
            "PACKAGE_NOT_DELETABLE",
            "Only packages in 'draft' status may be deleted.",
        )
    return Response(status_code=204)


@router.post("/packages/{package_id}/submit", response_model=TravelPackageSummary)
def submit_package(
    package_id: str,
    body: SubmitBody | None = None,
    ctx: dict = Depends(require_user_ctx),
):
    try:
        outcome, result = service.submit_package(
            package_id, ctx["headers"], body.submission_note if body else None
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _not_found()
    if outcome == "precondition_failed":
        return _err(
            422,
            "SUBMISSION_PRECONDITION_FAILED",
            " ".join(result.get("failures", [])) or "Submission pre-conditions not met.",
            result,
        )
    return result
