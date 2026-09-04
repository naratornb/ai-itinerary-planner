from fastapi import APIRouter, Depends, File, Form, Response, UploadFile

from app.core import _err, require_user_ctx
from app.media import service
from app.media.schemas import MediaListResponse, MediaUploadResponse

router = APIRouter()

_NOT_EDITABLE = (
    409,
    "PACKAGE_NOT_EDITABLE",
    "Media can only be modified while the package is in 'draft' or 'rejected' status.",
)


def _upstream(exc: service.UpstreamError):
    return _err(exc.status_code, "UPSTREAM_ERROR", exc.message)


@router.get("/media/{package_id}", response_model=MediaListResponse)
def list_package_media(package_id: str, ctx: dict = Depends(require_user_ctx)):
    try:
        outcome, rows = service.list_media(package_id, ctx["headers"])
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _err(404, "NOT_FOUND", "Package not found.")
    return {"data": rows, "total": len(rows)}


@router.post("/media/upload", status_code=201, response_model=MediaUploadResponse)
def upload_media(
    package_id: str = Form(...),
    file: UploadFile = File(...),
    is_cover: bool = Form(False),
    sort_order: int = Form(0),
    ctx: dict = Depends(require_user_ctx),
):
    try:
        outcome, result = service.upload_media(
            ctx, package_id, file, is_cover, sort_order
        )
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _err(404, "NOT_FOUND", "Package not found.")
    if outcome == "not_editable":
        return _err(*_NOT_EDITABLE)
    if outcome == "unsupported_type":
        return _err(
            400,
            "UNSUPPORTED_FILE_TYPE",
            "Only JPEG, PNG, WebP images and MP4/MOV videos are accepted.",
        )
    if outcome == "too_large":
        return _err(400, "FILE_TOO_LARGE", f"File exceeds the {result} MB limit.")
    return result


@router.delete("/media/{media_id}", status_code=204)
def delete_media(media_id: str, ctx: dict = Depends(require_user_ctx)):
    try:
        outcome, _ = service.delete_media(media_id, ctx)
    except service.UpstreamError as exc:
        return _upstream(exc)
    if outcome == "not_found":
        return _err(404, "NOT_FOUND", "Media not found.")
    if outcome == "not_editable":
        return _err(*_NOT_EDITABLE)
    return Response(status_code=204)
