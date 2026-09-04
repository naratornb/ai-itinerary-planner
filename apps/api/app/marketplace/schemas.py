from pydantic import BaseModel

from app.packages.schemas import PaginationMeta


class Influencer(BaseModel):
    display_name: str | None = None
    instagram_handle: str | None = None
    follower_count: int | None = None


class MarketplacePackageSummary(BaseModel):
    package_id: str
    title: str
    destination_country: str | None = None
    destination_city: str | None = None
    duration_days: int | None = None
    base_price_aud: int | None = None
    cover_image_url: str | None = None
    tags: list[str] = []
    influencer: Influencer | None = None
    published_at: str | None = None


class SearchResult(MarketplacePackageSummary):
    relevance_score: float | None = None


class MarketplaceListResponse(BaseModel):
    data: list[MarketplacePackageSummary]
    meta: PaginationMeta


class MarketplaceSearchResponse(BaseModel):
    query: str
    data: list[SearchResult]
    meta: PaginationMeta
