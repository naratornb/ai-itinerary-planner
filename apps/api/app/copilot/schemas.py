from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.packages.schemas import PaginationMeta


class PromptInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    prompt: str = Field(min_length=1, max_length=1000)


class FeedbackInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["accepted", "dismissed"]
    auto_apply: Literal[False] = False


class NextAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["recommend", "ask_clarification", "warn", "none"]
    label: str = Field(min_length=1, max_length=100)


class Warning(BaseModel):
    code: str
    message: str


class Suggestion(BaseModel):
    item_id: str
    item_type: Literal["activity", "hotel", "flight"]
    item_name: str
    city: str
    country: str | None = None
    price_aud: float | None = None
    price_unit: Literal["per_person", "per_night"]
    rating: float | None = None
    details: dict
    why_recommended: str
    status: Literal["pending", "accepted", "dismissed"] = "pending"


class TurnRead(BaseModel):
    turn_id: UUID
    package_id: UUID
    prompt: str
    created_at: datetime
    message: str
    next_action: NextAction
    warnings: list[Warning]
    suggestions: list[Suggestion]
    generation_mode: Literal["llm", "inventory_fallback", "clarification"]
    response_time_ms: int = Field(ge=0)


class TurnList(BaseModel):
    data: list[TurnRead]
    meta: PaginationMeta


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    item_id: str
    why_recommended: str = Field(min_length=1, max_length=240)


class ModelOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=800)
    next_action: NextAction
    selections: list[Selection] = Field(min_length=1, max_length=5)
