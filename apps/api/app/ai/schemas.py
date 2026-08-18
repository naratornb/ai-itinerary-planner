from pydantic import BaseModel, Field

from app.packages.schemas import PaginationMeta, TravelPackageDetail


class AISuggestRequest(BaseModel):
    package_id: str
    prompt: str = Field(min_length=10, max_length=1000)


class AISuggestion(BaseModel):
    suggestion_id: str
    package_id: str
    prompt: str
    suggestion_text: str
    status: str
    generated_at: str
    accepted_at: str | None = None
    response_time_ms: int


class AISuggestionListResponse(BaseModel):
    data: list[AISuggestion]
    meta: PaginationMeta


class AISuggestionAcceptRequest(BaseModel):
    auto_apply: bool = True


class AISuggestionAcceptResponse(BaseModel):
    suggestion: AISuggestion
    package: TravelPackageDetail | None = None
