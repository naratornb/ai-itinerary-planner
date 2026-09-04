from datetime import date
from typing import Any

from pydantic import BaseModel, Field

# Input models mirror openapi.yaml FlightInput/HotelInput/ActivityInput.
# Datetimes stay strings: PostgREST round-trips ISO-8601 as-is and we have
# no timezone maths to do on them.


class FlightInput(BaseModel):
    origin_iata: str = Field(min_length=3, max_length=3)
    destination_iata: str = Field(min_length=3, max_length=3)
    airline: str
    flight_number: str | None = None
    departure_datetime: str
    arrival_datetime: str
    cabin_class: str | None = None
    price_aud: int | None = None


class HotelInput(BaseModel):
    hotel_name: str
    star_rating: int | None = Field(default=None, ge=1, le=5)
    city: str
    address: str | None = None
    check_in_date: date
    check_out_date: date
    price_per_night_aud: int | None = None
    room_type: str | None = None


class ActivityInput(BaseModel):
    activity_name: str
    activity_date: date
    city: str
    duration_hours: float | None = None
    price_aud: int | None = None
    description: str | None = None
    booking_required: bool | None = None


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


class TravelPackageUpdate(BaseModel):
    """Metadata only — components are replaced by delete/re-add, per the spec."""

    title: str | None = Field(default=None, max_length=200)
    description: str | None = None
    destination_country: str | None = None
    destination_city: str | None = None
    duration_days: int | None = Field(default=None, ge=1)
    base_price_aud: int | None = Field(default=None, ge=0)
    max_group_size: int | None = None
    tags: list[str] | None = None


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
    sequence_order: int | None = None
    origin_iata: str | None = None
    destination_iata: str | None = None
    airline: str | None = None
    flight_number: str | None = None
    departure_datetime: str | None = None
    arrival_datetime: str | None = None
    cabin_class: str | None = None
    price_aud: int | None = None


class HotelDetailOut(BaseModel):
    hotel_id: str | None = None
    sequence_order: int | None = None
    hotel_name: str | None = None
    star_rating: float | None = None
    city: str | None = None
    address: str | None = None
    check_in_date: str | None = None
    check_out_date: str | None = None
    price_per_night_aud: int | None = None
    room_type: str | None = None


class ActivityDetailOut(BaseModel):
    activity_id: str | None = None
    sequence_order: int | None = None
    activity_name: str | None = None
    activity_date: str | None = None
    city: str | None = None
    duration_hours: float | None = None
    price_aud: int | None = None
    description: str | None = None
    booking_required: bool | None = None


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
