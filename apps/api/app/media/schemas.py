from pydantic import BaseModel


class MediaItem(BaseModel):
    media_id: str
    package_id: str
    media_type: str
    url: str
    thumbnail_url: str | None = None
    caption: str | None = None
    is_cover: bool = False
    sort_order: int = 0
    uploaded_at: str | None = None


class MediaListResponse(BaseModel):
    data: list[MediaItem]
    total: int


class MediaUploadResponse(BaseModel):
    media_id: str
    package_id: str
    url: str
    media_type: str
    filename: str | None = None
    file_size_bytes: int | None = None
    uploaded_at: str | None = None
