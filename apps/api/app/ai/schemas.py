import math

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class RecommendRequest(BaseModel):
    # Strip first, then length-check, so a whitespace-only query is a 422
    # rather than an expensive Supabase + Gemini round trip.
    model_config = ConfigDict(str_strip_whitespace=True)

    query: str = Field(..., min_length=1, description="Natural-language trip request")
    origin_city: str = "Sydney"


class _EngineModel(BaseModel):
    """Base for engine output — permissive on purpose.

    engine.generate_itinerary() has a fallback path that omits fields and
    passes inventory rows through untouched, so every field is optional and
    unknown keys are kept. Inventory rows come from pandas, which yields NaN
    for a null numeric column; NaN in a declared field fails response
    serialisation, so it is normalised to None here. A response_model that
    rejects a real itinerary would be worse than no response_model at all.
    """

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="before")
    @classmethod
    def _nan_to_none(cls, data):
        if isinstance(data, dict):
            return {
                key: None if isinstance(value, float) and math.isnan(value) else value
                for key, value in data.items()
            }
        return data


class TravelDates(_EngineModel):
    depart_date: str | None = None
    return_date: str | None = None


class ItineraryMeta(_EngineModel):
    trip_id: str | None = None
    created_at: str | None = None
    version: str | None = None


class ItineraryTrip(_EngineModel):
    title: str | None = None
    destination_cities: list[str] = []
    duration_days: int | None = None
    theme: str | None = None
    travel_dates: TravelDates | None = None
    total_cost_aud: float | None = None
    currency: str | None = None
    group_size: int | None = None
    status: str | None = None


class ItineraryFlight(_EngineModel):
    flight_id: str | None = None
    leg: str | None = None
    airline: str | None = None
    origin: str | None = None
    destination: str | None = None
    departure_datetime: str | None = None
    arrival_datetime: str | None = None
    cabin_class: str | None = None
    price_aud: float | None = None
    seats_available: int | None = None
    booking_class: str | None = None
    stops: int | None = None
    baggage_kg: float | None = None
    refundable: bool | None = None


class ItineraryAccommodation(_EngineModel):
    hotel_id: str | None = None
    hotel_name: str | None = None
    city: str | None = None
    star_rating: float | None = None
    room_type: str | None = None
    price_per_night_aud: float | None = None
    nights: int | None = None
    total_price_aud: float | None = None
    check_in: str | None = None
    check_out: str | None = None
    amenities: str | None = None
    breakfast_included: bool | None = None
    cancellation_policy: str | None = None


class ItineraryActivity(_EngineModel):
    activity_id: str | None = None
    activity_name: str | None = None
    category: str | None = None
    start_time: str | None = None
    duration_hours: float | None = None
    price_aud: float | None = None
    rating: float | None = None
    address: str | None = None
    notes: str | None = None


class ItineraryDay(_EngineModel):
    day_number: int | None = None
    date: str | None = None
    city: str | None = None
    title: str | None = None
    description: str | None = None
    activities: list[ItineraryActivity] = []


class BudgetBreakdown(_EngineModel):
    flights_aud: float | None = None
    accommodation_aud: float | None = None
    activities_aud: float | None = None
    estimated_meals_aud: float | None = None
    estimated_transport_aud: float | None = None
    total_aud: float | None = None


class ItineraryValidation(_EngineModel):
    is_valid: bool | None = None
    bookable: bool | None = None
    warnings: list[str] = []
    errors: list[str] = []


class Itinerary(_EngineModel):
    meta: ItineraryMeta | None = None
    trip: ItineraryTrip | None = None
    description: str | None = None
    flights: list[ItineraryFlight] = []
    accommodation: list[ItineraryAccommodation] = []
    days: list[ItineraryDay] = []
    budget_breakdown: BudgetBreakdown | None = None
    validation: ItineraryValidation | None = None
    bookable: bool | None = None
