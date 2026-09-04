from typing import Literal

from pydantic import BaseModel, Field

from app.packages.schemas import PaginationMeta, TravelPackageSummary


class ApproveRequest(BaseModel):
    notes: str | None = None


class RejectRequest(BaseModel):
    rejection_reason: str = Field(min_length=10)
    notes: str | None = None


class ApprovalRecord(BaseModel):
    """Spec shape — `notes` is admin-internal and deliberately not returned."""

    approval_id: str
    package_id: str
    reviewer_id: str
    decision: Literal["approved", "rejected"]
    rejection_reason: str | None = None
    reviewed_at: str


class ApprovalListResponse(BaseModel):
    data: list[TravelPackageSummary]
    meta: PaginationMeta


class DecisionResponse(BaseModel):
    package: TravelPackageSummary
    approval: ApprovalRecord
