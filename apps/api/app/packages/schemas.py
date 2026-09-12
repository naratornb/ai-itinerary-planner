import re
from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# Input models mirror openapi.yaml FlightInput/HotelInput/ActivityInput.
# Datetimes stay strings: PostgREST round-trips ISO-8601 as-is and we have
# no timezone maths to do on them.

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _reject_duplicate_media_ids(media_ids: list[UUID]) -> list[UUID]:
    if len(media_ids) != len(set(media_ids)):
        raise ValueError("media_ids must not contain duplicates")
    return media_ids


class FlightInput(BaseModel):
    origin_iata: str = Field(min_length=3, max_length=3)
    destination_iata: str = Field(min_length=3, max_length=3)
    airline: str
    flight_number: str | None = None
    departure_datetime: str
    arrival_datetime: str
    cabin_class: str | None = None
    price_aud: int | None = Field(default=None, ge=0)
    day_number: int | None = Field(default=None, ge=1)
    sequence_order: int | None = Field(default=None, ge=1)
    notes: str | None = None
    media_ids: list[UUID] = []
    source_id: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "FlightInput":
        _reject_duplicate_media_ids(self.media_ids)
        try:
            departure = datetime.fromisoformat(self.departure_datetime)
            arrival = datetime.fromisoformat(self.arrival_datetime)
        except ValueError as exc:
            raise ValueError(f"invalid flight timestamp: {exc}") from exc
        if arrival <= departure:
            raise ValueError("arrival_datetime must be after departure_datetime")
        return self


class HotelInput(BaseModel):
    hotel_name: str
    star_rating: int | None = Field(default=None, ge=1, le=5)
    city: str
    address: str | None = None
    check_in_date: date | None = None
    check_out_date: date | None = None
    check_in_day: int | None = Field(default=None, ge=1)
    check_out_day: int | None = Field(default=None, ge=1)
    price_per_night_aud: int | None = Field(default=None, ge=0)
    room_type: str | None = None
    sequence_order: int | None = Field(default=None, ge=1)
    notes: str | None = None
    media_ids: list[UUID] = []
    source_id: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "HotelInput":
        _reject_duplicate_media_ids(self.media_ids)
        has_dates = self.check_in_date is not None and self.check_out_date is not None
        has_days = self.check_in_day is not None and self.check_out_day is not None
        if not has_dates and not has_days:
            raise ValueError(
                "hotel requires either check_in_date/check_out_date or "
                "check_in_day/check_out_day"
            )
        if has_dates and self.check_out_date <= self.check_in_date:
            raise ValueError("check_out_date must be after check_in_date")
        if has_days and self.check_out_day <= self.check_in_day:
            raise ValueError("check_out_day must be after check_in_day")
        return self


class ActivityInput(BaseModel):
    activity_name: str
    activity_date: date | None = None
    city: str
    day_number: int | None = Field(default=None, ge=1)
    sequence_order: int | None = Field(default=None, ge=1)
    start_time: str | None = Field(default=None, pattern=_TIME_RE.pattern)
    duration_hours: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    price_aud: int | None = Field(default=None, ge=0)
    category: str | None = None
    address: str | None = None
    notes: str | None = None
    description: str | None = None
    booking_required: bool | None = None
    media_ids: list[UUID] = []
    source_id: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "ActivityInput":
        _reject_duplicate_media_ids(self.media_ids)
        if self.activity_date is None and self.day_number is None:
            raise ValueError("activity requires activity_date or day_number")
        return self


class PackageDayInput(BaseModel):
    day_number: int = Field(ge=1)
    title: str | None = None
    summary: str | None = None
    meta: str | None = None
    media_ids: list[UUID] = []

    @model_validator(mode="after")
    def _validate(self) -> "PackageDayInput":
        _reject_duplicate_media_ids(self.media_ids)
        return self


def _reject_duplicate_days(days: list[PackageDayInput]) -> None:
    day_numbers = [day.day_number for day in days]
    if len(day_numbers) != len(set(day_numbers)):
        raise ValueError("days must not contain duplicate day_number values")


class TravelPackageCreate(BaseModel):
    title: str = Field(max_length=200)
    description: str
    destination_country: str
    destination_city: str
    duration_days: int = Field(ge=1)
    base_price_aud: int = Field(ge=0)
    max_group_size: int | None = None
    tags: list[str] = []
    flights: list[FlightInput] = []
    hotels: list[HotelInput] = []
    activities: list[ActivityInput] = []
    days: list[PackageDayInput] = []

    @model_validator(mode="after")
    def _validate_days(self) -> "TravelPackageCreate":
        _reject_duplicate_days(self.days)
        return self


class TravelPackageUpdate(BaseModel):
    """Partial metadata update; flights/hotels/activities replace the
    package's stored collection when supplied. Per section 1 of the plan:
    omission means unchanged, [] clears, explicit null is rejected (422) for
    flights/hotels/activities. `days: null` stays "no change" for backward
    compatibility; `days: []` clears day narratives.
    """

    title: str | None = Field(default=None, max_length=200)
    description: str | None = None
    destination_country: str | None = None
    destination_city: str | None = None
    duration_days: int | None = Field(default=None, ge=1)
    base_price_aud: int | None = Field(default=None, ge=0)
    max_group_size: int | None = None
    tags: list[str] | None = None
    flights: list[FlightInput] | None = None
    hotels: list[HotelInput] | None = None
    activities: list[ActivityInput] | None = None
    days: list[PackageDayInput] | None = None

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null_collections(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for field in ("flights", "hotels", "activities"):
                if field in data and data[field] is None:
                    raise ValueError(
                        f"{field} cannot be null; omit to leave unchanged or "
                        "supply [] to clear it"
                    )
        return data

    @model_validator(mode="after")
    def _validate_days(self) -> "TravelPackageUpdate":
        if self.days is not None:
            _reject_duplicate_days(self.days)
        return self


class SubmitBody(BaseModel):
    submission_note: str | None = Field(default=None, max_length=500)


class TravelPackageSummary(BaseModel):
    package_id: str
    title: str
    # Nullable in the DB (0001 baseline) and writable to NULL via PUT, so the
    # out-contract must tolerate None or reads 500 on legacy rows.
    destination_country: str | None = None
    destination_city: str | None = None
    duration_days: int | None = None
    base_price_aud: int
    status: str
    creator_id: str
    created_at: str
    submitted_at: str | None = None
    published_at: str | None = None
    cover_image_url: str | None = None


# Detail outputs deliberately do NOT inherit the *Input models: DB rows are the
# contract on the way out — pre-0006 rows have nulls and legacy formats
# (e.g. flights.origin "Sydney (SYD)", float star ratings). Same lenient posture
# as MediaItemOut: everything optional, no constraints.
class FlightDetailOut(BaseModel):
    flight_id: str | None = None
    package_component_id: str | None = None
    sequence_order: int | None = None
    origin_iata: str | None = None
    destination_iata: str | None = None
    airline: str | None = None
    flight_number: str | None = None
    departure_datetime: str | None = None
    arrival_datetime: str | None = None
    cabin_class: str | None = None
    price_aud: int | None = None
    day_number: int | None = None
    notes: str | None = None
    media_ids: list[str] = []
    source_id: str | None = None


class HotelDetailOut(BaseModel):
    hotel_id: str | None = None
    package_component_id: str | None = None
    sequence_order: int | None = None
    hotel_name: str | None = None
    star_rating: float | None = None
    city: str | None = None
    address: str | None = None
    check_in_date: str | None = None
    check_out_date: str | None = None
    check_in_day: int | None = None
    check_out_day: int | None = None
    price_per_night_aud: int | None = None
    room_type: str | None = None
    notes: str | None = None
    media_ids: list[str] = []
    source_id: str | None = None


class ActivityDetailOut(BaseModel):
    activity_id: str | None = None
    package_component_id: str | None = None
    sequence_order: int | None = None
    activity_name: str | None = None
    activity_date: str | None = None
    city: str | None = None
    day_number: int | None = None
    start_time: str | None = None
    duration_hours: float | None = None
    price_aud: int | None = None
    category: str | None = None
    address: str | None = None
    notes: str | None = None
    description: str | None = None
    booking_required: bool | None = None
    media_ids: list[str] = []
    source_id: str | None = None


# Media/day/creator shapes are passed through from PostgREST unchanged, so
# every field is optional — the DB is the contract here, not this model.
class MediaItemOut(BaseModel):
    media_id: str | None = None
    package_id: str | None = None
    media_type: str | None = None
    url: str | None = None
    thumbnail_url: str | None = None
    caption: str | None = None
    is_cover: bool | None = None
    sort_order: int | None = None
    uploaded_at: str | None = None


class PackageDayOut(BaseModel):
    id: str | None = None
    package_id: str | None = None
    day_number: int | None = None
    title: str | None = None
    summary: str | None = None
    meta: str | None = None
    media_ids: list[str] = []


class PackageCreatorOut(BaseModel):
    full_name: str | None = None
    avatar_url: str | None = None
    influencer_profiles: Any | None = None


class PricingOut(BaseModel):
    flights_total: int = 0
    hotels_total: int = 0
    activities_total: int = 0
    components_total: int = 0
    base_price_aud: int | None = None


class TravelPackageDetail(TravelPackageSummary):
    description: str | None = None
    max_group_size: int | None = None
    tags: list[str] = []
    flights: list[FlightDetailOut] = []
    hotels: list[HotelDetailOut] = []
    activities: list[ActivityDetailOut] = []
    media: list[MediaItemOut] = []
    days: list[PackageDayOut] = []
    creator: PackageCreatorOut | None = None
    latest_approval: Any | None = None
    pricing: PricingOut | None = None


class PaginationMeta(BaseModel):
    total: int
    page: int
    per_page: int
    total_pages: int


class PackageListResponse(BaseModel):
    data: list[TravelPackageSummary]
    meta: PaginationMeta
