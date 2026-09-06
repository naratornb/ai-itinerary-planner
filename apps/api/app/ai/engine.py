"""
engine.py — AI Itinerary Builder
=================================

Main entry point:

    from app.ai.engine import generate_itinerary

    result = generate_itinerary(
        "5 days Japan for 2 people, budget $8000 AUD",
        origin_city="Sydney",
        verbose=True
    )

Pipeline
--------
1. parse_user_request()
2. load Supabase inventory
3. normalize airport/city names
4. query_inventory()
5. build_ai_prompt()
6. call Gemini with retry
7. parse Gemini JSON
8. validate against REAL inventory
9. deterministic budget calculation
10. calculate valid/bookable
11. fallback if Gemini unavailable

IMPORTANT
---------
Gemini is responsible for itinerary planning and wording.

Gemini is NOT trusted for:
- prices
- totals
- inventory existence
- booking availability
- IDs
- bookable status

Those are calculated deterministically by this file.
"""

import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd

from .llm_provider import call_llm as _llm_call


# ============================================================================
# CONFIGURATION
# ============================================================================

MAX_LLM_ATTEMPTS = 4
MAX_JSON_ATTEMPTS = 4

MAX_FLIGHTS = 5
MAX_HOTELS = 4
MAX_ACTIVITIES = 8

MIN_SEATS = 1

DEFAULT_DURATION_DAYS = 5
DEFAULT_ORIGIN = "Sydney"
DEFAULT_TRAVEL_YEAR = 2026

# Four-line activity notes make the JSON several times larger than it
# was. 5000 truncated mid-object, which surfaced as repeated parse
# failures and a silent fallback.
LLM_MAX_TOKENS = 16000

# Estimated costs are deterministic and NOT supplied by Gemini.
MEAL_COST_PER_PERSON_PER_DAY = 60.0
TRANSPORT_COST_PER_PERSON_PER_DAY = 25.0


# ============================================================================
# CITY / AIRPORT NORMALIZATION
# ============================================================================

CITY_ALIASES = {
    "amsterdam": "Amsterdam",
    "athens": "Athens",
    "auckland": "Auckland",
    "bangkok": "Bangkok",
    "barcelona": "Barcelona",
    "berlin": "Berlin",
    "brisbane": "Brisbane",
    "buenos aires": "Buenos Aires",
    "busan": "Busan",
    "cairns": "Cairns",
    "cairo": "Cairo",
    "cancun": "Cancun",
    "cancún": "Cancun",
    "cape town": "Cape Town",
    "chiang mai": "Chiang Mai",
    "colombo": "Colombo",
    "cusco": "Cusco",
    "da nang": "Da Nang",
    "delhi": "Delhi",
    "denpasar": "Denpasar",
    "bali": "Denpasar",
    "doha": "Doha",
    "dubai": "Dubai",
    "edinburgh": "Edinburgh",
    "florence": "Florence",
    "firenze": "Florence",
    "hanoi": "Hanoi",
    "ho chi minh city": "Ho Chi Minh City",
    "saigon": "Ho Chi Minh City",
    "hcmc": "Ho Chi Minh City",
    "hong kong": "Hong Kong",
    "honolulu": "Honolulu",
    "hawaii": "Honolulu",
    "oahu": "Honolulu",
    "istanbul": "Istanbul",
    "jakarta": "Jakarta",
    "krakow": "Krakow",
    "kraków": "Krakow",
    "cracow": "Krakow",
    "kuala lumpur": "Kuala Lumpur",
    "kyoto": "Kyoto",
    "lisbon": "Lisbon",
    "london": "London",
    "los angeles": "Los Angeles",
    "madrid": "Madrid",
    "manila": "Manila",
    "marrakech": "Marrakech",
    "marrakesh": "Marrakech",
    "medellin": "Medellin",
    "medellín": "Medellin",
    "melbourne": "Melbourne",
    "mexico city": "Mexico City",
    "cdmx": "Mexico City",
    "mumbai": "Mumbai",
    "nairobi": "Nairobi",
    "new york": "New York",
    "nyc": "New York",
    "new york city": "New York",
    "nice": "Nice",
    "osaka": "Osaka",
    "paris": "Paris",
    "perth": "Perth",
    "phuket": "Phuket",
    "phuket island": "Phuket",
    "porto": "Porto",
    "prague": "Prague",
    "praha": "Prague",
    "queenstown": "Queenstown",
    "queenstown nz": "Queenstown",
    "reykjavik": "Reykjavik",
    "iceland": "Reykjavik",
    "reykjavík": "Reykjavik",
    "rio de janeiro": "Rio de Janeiro",
    "rio": "Rio de Janeiro",
    "rome": "Rome",
    "san francisco": "San Francisco",
    "santorini": "Santorini",
    "thira": "Santorini",
    "sapporo": "Sapporo",
    "hokkaido": "Sapporo",
    "seoul": "Seoul",
    "shanghai": "Shanghai",
    "singapore": "Singapore",
    "sydney": "Sydney",
    "taipei": "Taipei",
    "taiwan": "Taipei",
    "tokyo": "Tokyo",
    "valencia": "Valencia",
    "vancouver": "Vancouver",
    "venice": "Venice",
    "venezia": "Venice",
    "vienna": "Vienna",
    "wien": "Vienna",
}


COUNTRY_TO_CITIES = {
    "argentina": ["Buenos Aires"],
    "australia": ["Brisbane", "Cairns", "Melbourne", "Perth", "Sydney"],
    "austria": ["Vienna"],
    "brazil": ["Rio de Janeiro"],
    "canada": ["Vancouver"],
    "china": ["Hong Kong", "Shanghai"],
    "colombia": ["Medellin"],
    "czech republic": ["Prague"],
    "czechia": ["Prague"],
    "egypt": ["Cairo"],
    "france": ["Nice", "Paris"],
    "germany": ["Berlin"],
    "greece": ["Athens", "Santorini"],
    "iceland": ["Reykjavik"],
    "india": ["Delhi", "Mumbai"],
    "indonesia": ["Denpasar", "Jakarta"],
    "italy": ["Florence", "Rome", "Venice"],
    "japan": ["Kyoto", "Osaka", "Sapporo", "Tokyo"],
    "kenya": ["Nairobi"],
    "malaysia": ["Kuala Lumpur"],
    "mexico": ["Cancun", "Mexico City"],
    "morocco": ["Marrakech"],
    "netherlands": ["Amsterdam"],
    "holland": ["Amsterdam"],
    "new zealand": ["Auckland", "Queenstown"],
    "nz": ["Auckland", "Queenstown"],
    "peru": ["Cusco"],
    "philippines": ["Manila"],
    "poland": ["Krakow"],
    "portugal": ["Lisbon", "Porto"],
    "qatar": ["Doha"],
    "singapore": ["Singapore"],
    "south africa": ["Cape Town"],
    "south korea": ["Busan", "Seoul"],
    "korea": ["Busan", "Seoul"],
    "spain": ["Barcelona", "Madrid", "Valencia"],
    "sri lanka": ["Colombo"],
    "taiwan": ["Taipei"],
    "thailand": ["Bangkok", "Chiang Mai", "Phuket"],
    "turkey": ["Istanbul"],
    "united arab emirates": ["Dubai"],
    "uae": ["Dubai"],
    "united kingdom": ["Edinburgh", "London"],
    "uk": ["Edinburgh", "London"],
    "britain": ["Edinburgh", "London"],
    "england": ["Edinburgh", "London"],
    "united states": ["Honolulu", "Los Angeles", "New York", "San Francisco"],
    "usa": ["Honolulu", "Los Angeles", "New York", "San Francisco"],
    "us": ["Honolulu", "Los Angeles", "New York", "San Francisco"],
    "america": ["Honolulu", "Los Angeles", "New York", "San Francisco"],
    "vietnam": ["Da Nang", "Hanoi", "Ho Chi Minh City"],
}


AIRPORT_CODES = {
    "Sydney": ["SYD"],
    "Melbourne": ["MEL"],
    "Brisbane": ["BNE"],
    "Tokyo": ["NRT", "HND"],
    "Osaka": ["KIX", "ITM"],
    "Kyoto": ["KIX", "ITM"],
    "Singapore": ["SIN"],
    "Bangkok": ["BKK", "DMK"],
    "Seoul": ["ICN", "GMP"],
    "Hong Kong": ["HKG"],
    "Paris": ["CDG", "ORY"],
    "London": ["LHR", "LGW", "STN", "LTN"],
    "Dubai": ["DXB"],
    "Rome": ["FCO", "CIA"],
    "Barcelona": ["BCN"],
    "Berlin": ["BER"],
    "Amsterdam": ["AMS"],
    "Istanbul": ["IST", "SAW"],
    "Zurich": ["ZRH"],
    "Mumbai": ["BOM"],
    "Toronto": ["YYZ"],
    "Cape Town": ["CPT"],
    "New York": ["JFK", "EWR", "LGA"],
    "Los Angeles": ["LAX"],
    "San Francisco": ["SFO"],
}


def normalize_city(value) -> str:
    """
    Convert airport-style values to canonical city names.

    Examples:
        Sydney
        Sydney (SYD)
        SYD
        Tokyo (NRT)
        NRT

    all become:
        Sydney / Tokyo
    """

    if value is None:
        return ""

    text = str(value).strip()

    if not text:
        return ""

    # Exact canonical city
    for city in AIRPORT_CODES:
        if text.lower() == city.lower():
            return city

    # City (CODE)
    match = re.match(r"^(.*?)\s*\(([A-Za-z]{3})\)\s*$", text)

    if match:
        city_part = match.group(1).strip()
        code = match.group(2).upper()

        for city, codes in AIRPORT_CODES.items():
            if code in codes:
                return city

        # fallback to city portion
        return CITY_ALIASES.get(city_part.lower(), city_part)

    # Raw airport code
    if re.fullmatch(r"[A-Za-z]{3}", text):
        code = text.upper()

        for city, codes in AIRPORT_CODES.items():
            if code in codes:
                return city

    return CITY_ALIASES.get(text.lower(), text)


def normalize_cabin(value) -> str:
    """
    Normalize cabin names.

    premium_economy -> Premium Economy
    economy -> Economy
    business -> Business
    first -> First
    """

    if value is None:
        return ""

    text = str(value).strip().lower().replace("-", "_").replace(" ", "_")

    mapping = {
        "economy": "Economy",
        "standard": "Economy",
        "coach": "Economy",
        "premium_economy": "Premium Economy",
        "premiumeconomy": "Premium Economy",
        "business": "Business",
        "business_class": "Business",
        "first": "First",
        "first_class": "First",
    }

    return mapping.get(text, str(value).strip())


# ============================================================================
# THEME
# ============================================================================

THEME_KEYWORDS = {
    "luxury": [
        "luxury",
        "premium",
        "5-star",
        "five star",
        "high-end",
        "first class",
    ],
    "budget": [
        "budget",
        "cheap",
        "affordable",
        "backpacker",
        "low-cost",
    ],
    "adventure": [
        "adventure",
        "hiking",
        "outdoor",
        "extreme",
        "trek",
        "diving",
    ],
    "romance": [
        "romance",
        "romantic",
        "honeymoon",
        "couples",
        "anniversary",
    ],
    "culture": [
        "culture",
        "history",
        "museum",
        "heritage",
        "art",
        "historic",
    ],
    "food": [
        "food",
        "culinary",
        "gastronomy",
        "eat",
        "cuisine",
        "foodie",
    ],
    "family": [
        "family",
        "kids",
        "children",
        "child-friendly",
    ],
    "beach": [
        "beach",
        "island",
        "coast",
        "sea",
        "ocean",
        "surf",
    ],
    "seasonal": [
        "cherry blossom",
        "sakura",
        "autumn leaves",
        "foliage",
        "festival",
        "new year",
        "christmas",
        "carnival",
    ],
}


# ============================================================================
# CABIN PREFERENCE
# ============================================================================

CABIN_PREFERENCES = {
    "budget": [
        "Economy",
        "Premium Economy",
        "Business",
        "First",
    ],
    "culture": [
        "Economy",
        "Premium Economy",
        "Business",
        "First",
    ],
    "food": [
        "Economy",
        "Premium Economy",
        "Business",
        "First",
    ],
    "family": [
        "Economy",
        "Premium Economy",
        "Business",
        "First",
    ],
    "adventure": [
        "Economy",
        "Premium Economy",
        "Business",
        "First",
    ],
    "beach": [
        "Economy",
        "Premium Economy",
        "Business",
        "First",
    ],
    "seasonal": [
        "Economy",
        "Premium Economy",
        "Business",
        "First",
    ],
    "romance": [
        "Business",
        "Premium Economy",
        "Economy",
        "First",
    ],
    "luxury": [
        "First",
        "Business",
        "Premium Economy",
        "Economy",
    ],
}


# ============================================================================
# HOTEL PREFERENCE
# ============================================================================

MIN_STARS_BY_THEME = {
    "budget": 3,
    "culture": 3,
    "food": 3,
    "family": 3,
    "adventure": 3,
    "beach": 3,
    "seasonal": 3,
    "romance": 4,
    "luxury": 5,
}


# ============================================================================
# SUPABASE
# ============================================================================

_SB = None


def _get_supabase():
    global _SB

    if _SB is None:
        from supabase import create_client

        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

        if not url or not key:
            raise EnvironmentError(
                "SUPABASE_URL and SUPABASE_KEY must be set."
            )

        _SB = create_client(url, key)

    return _SB


def _fetch_all(table: str, page: int = 1000) -> pd.DataFrame:
    """
    Fetch all rows from Supabase in pages.
    """

    sb = _get_supabase()

    rows = []
    start = 0

    while True:
        result = (
            sb.table(table)
            .select("*")
            .range(start, start + page - 1)
            .execute()
        )

        chunk = result.data or []

        rows.extend(chunk)

        if len(chunk) < page:
            break

        start += page

    return pd.DataFrame(rows)


def _ensure_column(df, column, default):
    if column not in df.columns:
        df[column] = default


def _load_inventory():
    """
    Load and normalize Supabase inventory.
    """
    t0 = time.perf_counter()
    flights = _fetch_all("flights")
    t1 = time.perf_counter()

    hotels = _fetch_all("hotels")
    t2 = time.perf_counter()

    activities = _fetch_all("activities")
    t3 = time.perf_counter()

    print(
        f"[timing] supabase "
        f"flights={t1-t0:.1f}s "
        f"hotels={t2-t1:.1f}s "
        f"activities={t3-t2:.1f}s "
        f"total={t3-t0:.1f}s"
    )
    # ------------------------------------------------------------
    # Flights
    # ------------------------------------------------------------

    flights = flights.rename(
        columns={
            "duration_mins": "duration_minutes",
        }
    )

    _ensure_column(flights, "seats_available", 999)
    _ensure_column(flights, "booking_class", "Standard")

    # Normalize route fields
    if "origin" in flights.columns:
        flights["origin_city_normalized"] = flights["origin"].apply(
            normalize_city
        )

    if "destination" in flights.columns:
        flights["destination_city_normalized"] = flights["destination"].apply(
            normalize_city
        )

    if "cabin_class" in flights.columns:
        flights["cabin_normalized"] = flights["cabin_class"].apply(
            normalize_cabin
        )
    else:
        flights["cabin_normalized"] = "Economy"

    # ------------------------------------------------------------
    # Hotels
    # ------------------------------------------------------------

    _ensure_column(hotels, "max_guests", 999)
    _ensure_column(hotels, "property_type", "Hotel")

    if "city" in hotels.columns:
        hotels["city_normalized"] = hotels["city"].apply(
            normalize_city
        )

    # ------------------------------------------------------------
    # Activities
    # ------------------------------------------------------------

    _ensure_column(activities, "vibe", "")
    _ensure_column(activities, "best_season", "")
    _ensure_column(activities, "address", "")
    _ensure_column(activities, "availability", "Year-round")

    if "city" in activities.columns:
        activities["city_normalized"] = activities["city"].apply(
            normalize_city
        )

    print(
        f"[inventory] source=supabase | "
        f"flights={len(flights)} | "
        f"hotels={len(hotels)} | "
        f"activities={len(activities)}"
    )

    return flights, hotels, activities


# ============================================================================
# STEP 1 — PARSE USER REQUEST
# ============================================================================

def parse_user_request(
    user_input: str,
    origin_city: str = DEFAULT_ORIGIN,
) -> dict:

    text = user_input.lower()

    # ------------------------------------------------------------
    # Duration
    # ------------------------------------------------------------

    duration_match = re.search(
        r"(\d+)\s*(day|days|night|nights|week|weeks)",
        text,
    )

    if duration_match:
        value = int(duration_match.group(1))
        unit = duration_match.group(2)

        if "week" in unit:
            duration_days = value * 7
        else:
            duration_days = value
    else:
        duration_days = DEFAULT_DURATION_DAYS

    # ------------------------------------------------------------
    # Budget
    # ------------------------------------------------------------

    budget_aud = None

    patterns = [
        r"budget\s*[:=\-]?\s*\$\s*([\d,]+)",
        r"budget\s*[:=\-]?\s*([\d,]+)\s*(?:aud|dollars?)",
        r"\$\s*([\d,]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, text)

        if match:
            budget_aud = float(
                match.group(1).replace(",", "")
            )
            break

    # ------------------------------------------------------------
    # Group size
    # ------------------------------------------------------------

    group_match = re.search(
        r"(\d+)\s*(?:people|person|travellers?|travelers?|adults?|pax)",
        text,
    )

    group_size = (
        int(group_match.group(1))
        if group_match
        else 1
    )

    # ------------------------------------------------------------
    # Theme
    # ------------------------------------------------------------

    detected_theme = "culture"

    for theme, keywords in THEME_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            detected_theme = theme
            break

    # ------------------------------------------------------------
    # Destination
    # ------------------------------------------------------------

    destinations = []

    # Match on word boundaries, not raw substrings: a plain `alias in text`
    # lets "la" match inside "iceland" and hijack the destination.
    # Longest alias first so "new york city" wins over "new york".
    for alias in sorted(CITY_ALIASES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", text):
            destinations.append(CITY_ALIASES[alias])

    for country in sorted(COUNTRY_TO_CITIES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(country)}\b", text):
            destinations.extend(COUNTRY_TO_CITIES[country])

    destinations = list(
        dict.fromkeys(destinations)
    )

    if not destinations:
        destinations = ["Tokyo"]

    # ------------------------------------------------------------
    # Cabin preference
    # ------------------------------------------------------------

    if "first class" in text or "first-class" in text:
        cabin_preference = ["First", "Business", "Premium Economy", "Economy"]

    elif "business class" in text or "business" in text:
        cabin_preference = ["Business", "Premium Economy", "Economy", "First"]

    elif "premium economy" in text:
        cabin_preference = ["Premium Economy", "Economy", "Business", "First"]

    else:
        cabin_preference = CABIN_PREFERENCES.get(
            detected_theme,
            ["Economy", "Premium Economy", "Business", "First"],
        )

    min_stars = MIN_STARS_BY_THEME.get(
        detected_theme,
        3,
    )

    return {
        "raw_input": user_input,
        "origin": normalize_city(origin_city),
        "destinations": destinations,
        "duration_days": duration_days,
        "theme": detected_theme,
        "budget_aud": budget_aud,
        "group_size": group_size,
        "cabin_preference": cabin_preference,
        "min_stars": min_stars,
        "travel_year": DEFAULT_TRAVEL_YEAR,
    }


# ============================================================================
# FLIGHT HELPERS
# ============================================================================

def _route_matches(
    df: pd.DataFrame,
    origin: str,
    destination: str,
) -> pd.Series:

    origin = normalize_city(origin)
    destination = normalize_city(destination)

    return (
        df["origin_city_normalized"].eq(origin)
        &
        df["destination_city_normalized"].eq(destination)
    )


def _select_best_flights(
    flights_df: pd.DataFrame,
    origin: str,
    destination: str,
    cabin_preference: list,
    group_size: int,
) -> pd.DataFrame:

    mask = _route_matches(
        flights_df,
        origin,
        destination,
    )

    candidates = flights_df[mask].copy()

    if candidates.empty:
        return candidates

    # Seats
    if "seats_available" in candidates.columns:
        candidates = candidates[
            pd.to_numeric(
                candidates["seats_available"],
                errors="coerce",
            ).fillna(999)
            >= max(MIN_SEATS, group_size)
        ]

    if candidates.empty:
        return candidates

    # ------------------------------------------------------------
    # Flexible cabin selection
    #
    # Instead of:
    #
    # cabin == "Economy"
    #
    # we rank cabins.
    # ------------------------------------------------------------

    cabin_rank = {
        cabin: index
        for index, cabin in enumerate(cabin_preference)
    }

    candidates["cabin_rank"] = (
        candidates["cabin_normalized"]
        .map(cabin_rank)
        .fillna(99)
    )

    candidates["price_numeric"] = pd.to_numeric(
        candidates["price_aud"],
        errors="coerce",
    ).fillna(float("inf"))

    candidates = candidates.sort_values(
        ["cabin_rank", "price_numeric"]
    )

    return candidates.head(MAX_FLIGHTS)


# ============================================================================
# STEP 2 — QUERY INVENTORY
# ============================================================================

def query_inventory(params: dict) -> dict:

    flights_df, hotels_df, activities_df = _load_inventory()

    origin = params["origin"]
    destinations = params["destinations"]

    theme = params["theme"]
    duration_days = params.get("duration_days") or DEFAULT_DURATION_DAYS
    group_size = params["group_size"]
    budget = params.get("budget_aud")
    cabin_preference = params["cabin_preference"]
    min_stars = params["min_stars"]

    # ------------------------------------------------------------
    # OUTBOUND
    # ------------------------------------------------------------

    outbound = _select_best_flights(
        flights_df,
        origin,
        destinations[0],
        cabin_preference,
        group_size,
    )

    # ------------------------------------------------------------
    # RETURN
    # ------------------------------------------------------------

    inbound = _select_best_flights(
        flights_df,
        destinations[-1],
        origin,
        cabin_preference,
        group_size,
    )

    # ------------------------------------------------------------
    # INTER-CITY
    # ------------------------------------------------------------

    inter_city_legs = []

    for index in range(len(destinations) - 1):

        leg_df = _select_best_flights(
            flights_df,
            destinations[index],
            destinations[index + 1],
            cabin_preference,
            group_size,
        )

        inter_city_legs.append(
            {
                "from": destinations[index],
                "to": destinations[index + 1],
                "options": leg_df.to_dict(
                    orient="records"
                ),
            }
        )

    # ------------------------------------------------------------
    # HOTELS
    # ------------------------------------------------------------

    hotel_options = {}

    for city in destinations:

        city_mask = hotels_df["city_normalized"].eq(city)

        hotels = hotels_df[city_mask].copy()

        if "star_rating" in hotels.columns:
            stars = pd.to_numeric(
                hotels["star_rating"],
                errors="coerce",
            ).fillna(0)

            preferred = hotels[
                stars >= min_stars
            ]

            # If the preferred rating does not exist,
            # do NOT return zero hotels.
            if not preferred.empty:
                hotels = preferred

        if "max_guests" in hotels.columns:
            hotels = hotels[
                pd.to_numeric(
                    hotels["max_guests"],
                    errors="coerce",
                ).fillna(999)
                >= group_size
            ]

        # Budget should be a ranking preference,
        # not an aggressive filter that destroys inventory.
        if budget and not hotels.empty:

            hotels["price_numeric"] = pd.to_numeric(
                hotels["price_per_night_aud"],
                errors="coerce",
            ).fillna(float("inf"))

            hotels = hotels.sort_values(
                ["price_numeric"]
            )

        else:

            if "star_rating" in hotels.columns:

                hotels["stars_numeric"] = pd.to_numeric(
                    hotels["star_rating"],
                    errors="coerce",
                ).fillna(0)

                hotels = hotels.sort_values(
                    ["stars_numeric"],
                    ascending=False,
                )

        hotel_options[city] = hotels.head(
            MAX_HOTELS
        ).to_dict(
            orient="records"
        )

    # ------------------------------------------------------------
    # ACTIVITIES
    # ------------------------------------------------------------

    activity_options = {}

    for city in destinations:

        activities = activities_df[
            activities_df["city_normalized"].eq(city)
        ].copy()

        if "group_size_max" in activities.columns:
            activities = activities[
                pd.to_numeric(
                    activities["group_size_max"],
                    errors="coerce",
                ).fillna(999)
                >= group_size
            ]

        if activities.empty:
            activity_options[city] = []
            continue

        activities["rating_numeric"] = pd.to_numeric(
            activities["rating"],
            errors="coerce",
        ).fillna(0)

        # Theme matching if available.
        theme_text = activities.astype(str).agg(
            " ".join,
            axis=1,
        ).str.lower()

        theme_mask = theme_text.str.contains(
            re.escape(theme),
            na=False,
        )

        themed = activities[
            theme_mask
        ].sort_values(
            "rating_numeric",
            ascending=False,
        )

        others = activities[
            ~theme_mask
        ].sort_values(
            "rating_numeric",
            ascending=False,
        )

        combined = pd.concat(
            [themed, others]
        ).drop_duplicates(
            subset=["activity_id"]
            if "activity_id" in activities.columns
            else None
        )

        # Send enough options for the LLM to fill every day. A flat cap of
        # MAX_ACTIVITIES starves long trips: 8 options across 11 days forces
        # roughly one activity per day.
        # 3/day made the prompt large enough that Gemini exceeded the 60s
        # per-attempt timeout. 2/day, hard-capped, still fills every day.
        per_city_cap = min(
            16,
            max(
                MAX_ACTIVITIES,
                duration_days * 2 // max(1, len(destinations)),
            ),
        )

        activity_options[city] = combined.head(
            per_city_cap
        ).to_dict(
            orient="records"
        )

    # ------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------

    if outbound.empty:
        print(
            f"      ⚠ No outbound flights found "
            f"from {origin} → {destinations[0]}."
        )

    if inbound.empty:
        print(
            f"      ⚠ No return flights found "
            f"from {destinations[-1]} → {origin}."
        )

    print(
        f"      outbound={len(outbound)}"
    )

    print(
        f"      return={len(inbound)}"
    )

    for city in destinations:

        print(
            f"      {city}: "
            f"{len(hotel_options.get(city, []))} hotels"
        )

        print(
            f"      {city}: "
            f"{len(activity_options.get(city, []))} activities"
        )

    return {
        "outbound_flight_options": outbound.to_dict(
            orient="records"
        ),
        "inbound_flight_options": inbound.to_dict(
            orient="records"
        ),
        "inter_city_legs": inter_city_legs,
        "hotel_options": hotel_options,
        "activity_options": activity_options,
    }


# ============================================================================
# STEP 3 — AI PROMPT
# ============================================================================

SYSTEM_PROMPT = """
You are an expert travel itinerary planner.

You receive REAL travel inventory from a database.

Your job is to construct the best itinerary using ONLY the provided inventory.

CRITICAL RULES:

1. Return ONLY one valid JSON object.
2. Never use markdown fences.
3. Never invent IDs.
4. Never invent flights.
5. Never invent hotels.
6. Never invent activities.
7. Every selected flight_id MUST exist in the provided inventory.
8. Every selected hotel_id MUST exist in the provided inventory.
9. Every selected activity_id MUST exist in the provided inventory.
10. If a return flight is unavailable, return flights=[] or include only the available outbound flight.
11. Do NOT pretend unavailable inventory exists.
12. The engine will calculate the final budget deterministically.
13. Your budget_breakdown is only a planning estimate.
14. Do not claim an itinerary is bookable.
15. Days must contain exactly duration_days entries.
16. Keep descriptions concise so the JSON is complete.
17. Prefer cheaper options when the theme is budget.
18. Prefer higher-end options when the theme is luxury.
19. Match the requested group size.
20. Do not create fake flight routes.

The database is the source of truth.
""".strip()


def build_ai_prompt(
    params: dict,
    inventory: dict,
) -> str:

    return f"""
USER REQUEST:
{params["raw_input"]}

PARSED PARAMETERS:
{json.dumps(
    {k: v for k, v in params.items() if k != "raw_input"},
    indent=2,
    default=str,
)}

IMPORTANT:
The inventory uses airport-style values such as:
"Sydney (SYD)"
"Tokyo (NRT)"

These are normalized internally to:
"Sydney"
"Tokyo"

Do not invent flights if the relevant inventory section is empty.

ACTIVITY NOTES:
Every activity note must contain exactly these four lines, in this order,
separated by newline characters:

What you'll see: ...
What to bring: ...
What to eat: ...
Good to know: ...

Keep each line to one sentence. Base them on the activity name, category
and city. Write general, sensible travel guidance - do not state specific
opening hours, prices or street addresses that are not in the inventory.

ACTIVITY ADDRESS:
Copy the address field from the inventory record exactly. Never write an
address that is not in the inventory. If a record has no address, leave the
field as an empty string.

============================================================
OUTBOUND FLIGHTS
============================================================

{json.dumps(
    inventory["outbound_flight_options"],
    indent=2,
    default=str,
)}

============================================================
RETURN FLIGHTS
============================================================

{json.dumps(
    inventory["inbound_flight_options"],
    indent=2,
    default=str,
)}

============================================================
INTER-CITY FLIGHTS
============================================================

{json.dumps(
    inventory["inter_city_legs"],
    indent=2,
    default=str,
)}

============================================================
HOTELS
============================================================

{json.dumps(
    inventory["hotel_options"],
    indent=2,
    default=str,
)}

============================================================
ACTIVITIES
============================================================

{json.dumps(
    inventory["activity_options"],
    indent=2,
    default=str,
)}

============================================================
OUTPUT SCHEMA
============================================================

Return exactly:

{{
  "meta": {{
    "trip_id": "<uuid>",
    "created_at": "<ISO datetime>",
    "version": "1.0"
  }},

  "trip": {{
    "title": "<title>",
    "destination_cities": ["Tokyo"],
    "duration_days": {params["duration_days"]},
    "theme": "{params["theme"]}",
    "travel_dates": {{
      "depart_date": "<YYYY-MM-DD>",
      "return_date": "<YYYY-MM-DD>"
    }},
    "total_cost_aud": 0,
    "currency": "AUD",
    "group_size": {params["group_size"]},
    "status": "draft"
  }},

  "description": "<concise markdown itinerary>",

  "flights": [
    {{
      "flight_id": "<EXACT INVENTORY ID>",
      "leg": "outbound|return|inter-city",
      "airline": "<inventory value>",
      "origin": "<inventory value>",
      "destination": "<inventory value>",
      "departure_datetime": "<inventory value>",
      "arrival_datetime": "<inventory value>",
      "cabin_class": "<inventory value>",
      "price_aud": 0,
      "seats_available": 0,
      "booking_class": "<inventory value>",
      "stops": 0,
      "baggage_kg": 0,
      "refundable": false
    }}
  ],

  "accommodation": [
    {{
      "hotel_id": "<EXACT INVENTORY ID>",
      "hotel_name": "<inventory value>",
      "city": "<inventory value>",
      "star_rating": 0,
      "room_type": "<inventory value>",
      "price_per_night_aud": 0,
      "nights": 0,
      "total_price_aud": 0,
      "check_in": "<YYYY-MM-DD>",
      "check_out": "<YYYY-MM-DD>",
      "amenities": "<inventory value>",
      "breakfast_included": false,
      "cancellation_policy": "<inventory value>"
    }}
  ],

  "days": [
    {{
      "day_number": 1,
      "date": "<YYYY-MM-DD>",
      "city": "<city>",
      "title": "<title>",
      "description": "<short description>",
      "activities": [
        {{
          "activity_id": "<EXACT INVENTORY ID>",
          "activity_name": "<inventory value>",
          "category": "<inventory value>",
          "start_time": "10:00",
          "duration_hours": 2,
          "price_aud": 0,
          "rating": 0,
          "address": "<copy verbatim from the inventory record>",
          "notes": "What you'll see: <one sentence>\\nWhat to bring: <one sentence>\\nWhat to eat: <one sentence>\\nGood to know: <one sentence>"
        }}
      ]
    }}
  ],

  "budget_breakdown": {{
    "flights_aud": 0,
    "accommodation_aud": 0,
    "activities_aud": 0,
    "estimated_meals_aud": 0,
    "estimated_transport_aud": 0,
    "total_aud": 0
  }},

  "validation": {{
    "is_valid": false,
    "warnings": [],
    "errors": []
  }}
}}

REMEMBER:

The Python engine will overwrite:

- flight costs
- accommodation costs
- activity costs
- meals
- transport
- total cost
- validation
- bookable

Therefore focus on selecting valid inventory and creating the itinerary.

Return ONLY JSON.
""".strip()


# ============================================================================
# STEP 4 — LLM
# ============================================================================

def call_llm(
    system_prompt: str,
    user_prompt: str,
):
    """
    Call the project's shared LLM provider.

    llm_provider.py handles Gemini provider details.
    """

    return _llm_call(
        system_prompt,
        user_prompt,
        max_tokens=LLM_MAX_TOKENS,
    ).text


# ============================================================================
# JSON PARSING
# ============================================================================

def parse_llm_response(raw: str) -> dict:

    if not raw:
        raise json.JSONDecodeError(
            "Empty LLM response",
            "",
            0,
        )

    raw = raw.strip()

    # Remove code fences.
    if raw.startswith("```"):
        raw = re.sub(
            r"^```(?:json)?\s*",
            "",
            raw,
            flags=re.IGNORECASE,
        )

        raw = re.sub(
            r"\s*```$",
            "",
            raw,
        )

    # Find JSON object if Gemini included surrounding text.
    start = raw.find("{")
    end = raw.rfind("}")

    if start >= 0 and end > start:
        raw = raw[start:end + 1]

    return json.loads(raw)


# ============================================================================
# INVENTORY LOOKUP INDEX
# ============================================================================

def build_inventory_indexes(inventory: dict):

    flight_index = {}

    for group in [
        inventory.get("outbound_flight_options", []),
        inventory.get("inbound_flight_options", []),
    ]:

        for flight in group:

            if flight.get("flight_id") is not None:
                flight_index[str(
                    flight["flight_id"]
                )] = flight

    for leg in inventory.get(
        "inter_city_legs",
        [],
    ):

        for flight in leg.get(
            "options",
            [],
        ):

            if flight.get("flight_id") is not None:
                flight_index[str(
                    flight["flight_id"]
                )] = flight

    hotel_index = {}

    for hotels in inventory.get(
        "hotel_options",
        {}
    ).values():

        for hotel in hotels:

            if hotel.get("hotel_id") is not None:
                hotel_index[str(
                    hotel["hotel_id"]
                )] = hotel

    activity_index = {}

    for activities in inventory.get(
        "activity_options",
        {}
    ).values():

        for activity in activities:

            if activity.get("activity_id") is not None:
                activity_index[str(
                    activity["activity_id"]
                )] = activity

    return (
        flight_index,
        hotel_index,
        activity_index,
    )


# ============================================================================
# DETERMINISTIC COST CALCULATION
# ============================================================================

def calculate_deterministic_budget(
    itinerary: dict,
    params: dict,
) -> dict:

    group_size = int(
        params.get(
            "group_size",
            1,
        )
    )

    duration_days = int(
        params.get(
            "duration_days",
            1,
        )
    )

    # ------------------------------------------------------------
    # Flights
    #
    # Assumption:
    # inventory flight price = price per person.
    # Therefore multiply by group size.
    # ------------------------------------------------------------

    flights_total = 0.0

    for flight in itinerary.get(
        "flights",
        []
    ):

        price = pd.to_numeric(
            flight.get("price_aud", 0),
            errors="coerce",
        )

        if pd.isna(price):
            price = 0

        flights_total += float(price) * group_size

    # ------------------------------------------------------------
    # Hotels
    # ------------------------------------------------------------

    accommodation_total = 0.0

    for hotel in itinerary.get(
        "accommodation",
        []
    ):

        nightly = pd.to_numeric(
            hotel.get(
                "price_per_night_aud",
                0,
            ),
            errors="coerce",
        )

        if pd.isna(nightly):
            nightly = 0

        nights = pd.to_numeric(
            hotel.get(
                "nights",
                0,
            ),
            errors="coerce",
        )

        if pd.isna(nights):
            nights = 0

        accommodation_total += (
            float(nightly)
            * int(nights)
        )

    # ------------------------------------------------------------
    # Activities
    #
    # Assume activity price is per person.
    # ------------------------------------------------------------

    activities_total = 0.0

    for day in itinerary.get(
        "days",
        []
    ):

        for activity in day.get(
            "activities",
            []
        ):

            price = pd.to_numeric(
                activity.get(
                    "price_aud",
                    0,
                ),
                errors="coerce",
            )

            if pd.isna(price):
                price = 0

            activities_total += (
                float(price)
                * group_size
            )

    # ------------------------------------------------------------
    # Estimated meals
    # ------------------------------------------------------------

    meals_total = (
        MEAL_COST_PER_PERSON_PER_DAY
        * group_size
        * duration_days
    )

    # ------------------------------------------------------------
    # Estimated transport
    # ------------------------------------------------------------

    transport_total = (
        TRANSPORT_COST_PER_PERSON_PER_DAY
        * group_size
        * duration_days
    )

    total = (
        flights_total
        + accommodation_total
        + activities_total
        + meals_total
        + transport_total
    )

    return {
        "flights_aud": round(
            flights_total,
            2,
        ),
        "accommodation_aud": round(
            accommodation_total,
            2,
        ),
        "activities_aud": round(
            activities_total,
            2,
        ),
        "estimated_meals_aud": round(
            meals_total,
            2,
        ),
        "estimated_transport_aud": round(
            transport_total,
            2,
        ),
        "total_aud": round(
            total,
            2,
        ),
    }


# ============================================================================
# VALIDATION
# ============================================================================

REQUIRED_KEYS = {
    "meta",
    "trip",
    "description",
    "flights",
    "accommodation",
    "days",
    "budget_breakdown",
    "validation",
}


# ── Post-processing: overwrite model output with inventory values ────────────

def _enrich_from_inventory(itinerary: dict, inventory: dict) -> dict:
    """
    Replace every factual activity field with the value from the inventory
    record of the same activity_id.

    The prompt already tells the model to copy these verbatim, but an
    instruction is not a guarantee. Overwriting them here makes fabricated
    prices, ratings, durations and addresses structurally impossible, which
    is the same reason the pipeline uses retrieval rather than a bare LLM
    call. Prose fields the model is meant to write - notes, day titles,
    descriptions - are left untouched.
    """
    lookup = {}
    for records in (inventory.get("activity_options") or {}).values():
        for rec in records:
            aid = rec.get("activity_id")
            if aid:
                lookup[str(aid)] = rec

    if not lookup:
        return itinerary

    unknown = []

    for day in itinerary.get("days", []) or []:
        for act in day.get("activities", []) or []:
            rec = lookup.get(str(act.get("activity_id", "")))

            if rec is None:
                # Not in the inventory we sent - the model invented it.
                unknown.append(act.get("activity_id"))
                continue

            act["activity_name"] = rec.get("activity_name", act.get("activity_name"))
            act["category"]      = rec.get("category",      act.get("category"))
            act["address"]       = rec.get("address", "") or ""
            act["price_aud"]     = rec.get("price_aud",     act.get("price_aud"))
            act["rating"]        = rec.get("rating",        act.get("rating"))
            act["duration_hours"] = rec.get(
                "duration_hours", act.get("duration_hours")
            )

    if unknown:
        print(
            f"      [inventory] dropped {len(unknown)} activity id(s) not in "
            f"inventory: {unknown[:5]}"
        )
        for day in itinerary.get("days", []) or []:
            day["activities"] = [
                a for a in (day.get("activities") or [])
                if str(a.get("activity_id", "")) in lookup
            ]

    return itinerary


def validate_itinerary(
    itinerary: dict,
    params: dict,
    inventory: dict,
) -> dict:

    warnings = []
    errors = []

    # ------------------------------------------------------------
    # Structure
    # ------------------------------------------------------------

    missing = REQUIRED_KEYS - set(
        itinerary.keys()
    )

    if missing:
        errors.append(
            f"Missing required sections: {sorted(missing)}"
        )

    itinerary.setdefault(
        "flights",
        []
    )

    itinerary.setdefault(
        "accommodation",
        []
    )

    itinerary.setdefault(
        "days",
        []
    )

    itinerary.setdefault(
        "trip",
        {}
    )

    # ------------------------------------------------------------
    # Inventory indexes
    # ------------------------------------------------------------

    (
        flight_index,
        hotel_index,
        activity_index,
    ) = build_inventory_indexes(
        inventory
    )

    # ------------------------------------------------------------
    # Validate flights
    # ------------------------------------------------------------

    selected_flights = itinerary["flights"]

    valid_flights = []

    outbound_found = False
    return_found = False

    for flight in selected_flights:

        flight_id = str(
            flight.get(
                "flight_id",
                ""
            )
        )

        if flight_id not in flight_index:

            errors.append(
                f"Flight ID '{flight_id}' does not exist in inventory."
            )

            continue

        real = flight_index[flight_id]

        # Replace Gemini's potentially invented values
        # with REAL inventory values.

        for field in [
            "flight_id",
            "airline",
            "origin",
            "destination",
            "departure_datetime",
            "arrival_datetime",
            "cabin_class",
            "price_aud",
            "seats_available",
            "booking_class",
            "stops",
            "baggage_kg",
            "refundable",
        ]:

            if field in real:
                flight[field] = real[field]

        leg = str(
            flight.get(
                "leg",
                ""
            )
        ).lower()

        if leg == "outbound":
            outbound_found = True

        elif leg == "return":
            return_found = True

        valid_flights.append(
            flight
        )

    itinerary["flights"] = valid_flights

    # ------------------------------------------------------------
    # Determine whether route inventory exists
    # ------------------------------------------------------------

    outbound_inventory = inventory.get(
        "outbound_flight_options",
        []
    )

    return_inventory = inventory.get(
        "inbound_flight_options",
        []
    )

    if not outbound_inventory:

        warnings.append(
            f"No outbound flights found from "
            f"{params['origin']} → "
            f"{params['destinations'][0]}."
        )

    if not return_inventory:

        warnings.append(
            f"No return flights found from "
            f"{params['destinations'][-1]} → "
            f"{params['origin']}."
        )

    # ------------------------------------------------------------
    # Required booking legs
    # ------------------------------------------------------------

    if not outbound_found:

        errors.append(
            "Outbound flight is missing."
        )

    if not return_found:

        errors.append(
            "Return flight is missing."
        )

    # ------------------------------------------------------------
    # Hotel validation
    # ------------------------------------------------------------

    if not itinerary["accommodation"]:

        errors.append(
            "No accommodation selected."
        )

    valid_hotels = []

    for hotel in itinerary["accommodation"]:

        hotel_id = str(
            hotel.get(
                "hotel_id",
                ""
            )
        )

        if hotel_id not in hotel_index:

            errors.append(
                f"Hotel ID '{hotel_id}' does not exist in inventory."
            )

            continue

        real = hotel_index[hotel_id]

        for field in [
            "hotel_id",
            "hotel_name",
            "city",
            "star_rating",
            "room_type",
            "price_per_night_aud",
            "amenities",
            "breakfast_included",
            "cancellation_policy",
        ]:

            if field in real:
                hotel[field] = real[field]

        valid_hotels.append(
            hotel
        )

    itinerary["accommodation"] = valid_hotels

    # ------------------------------------------------------------
    # Activity validation
    # ------------------------------------------------------------

    for day in itinerary["days"]:

        for activity in day.get(
            "activities",
            []
        ):

            activity_id = str(
                activity.get(
                    "activity_id",
                    ""
                )
            )

            if activity_id not in activity_index:

                errors.append(
                    f"Activity ID '{activity_id}' "
                    f"does not exist in inventory."
                )

                continue

            real = activity_index[
                activity_id
            ]

            for field in [
                "activity_id",
                "activity_name",
                "category",
                "price_aud",
                "rating",
            ]:

                if field in real:
                    activity[field] = real[field]

    # ------------------------------------------------------------
    # Day count
    # ------------------------------------------------------------

    expected_days = int(
        params.get(
            "duration_days",
            1,
        )
    )

    actual_days = len(
        itinerary["days"]
    )

    if actual_days != expected_days:

        errors.append(
            f"Day count mismatch: "
            f"{actual_days} generated, "
            f"{expected_days} expected."
        )

    # ------------------------------------------------------------
    # Deterministic budget
    # ------------------------------------------------------------

    budget = calculate_deterministic_budget(
        itinerary,
        params,
    )

    old_total = itinerary.get(
        "budget_breakdown",
        {}
    ).get(
        "total_aud"
    )

    if (
        old_total is not None
        and abs(
            float(old_total)
            - budget["total_aud"]
        ) > 1
    ):

        warnings.append(
            f"Budget total corrected from "
            f"{float(old_total):.2f} AUD "
            f"to "
            f"{budget['total_aud']:.2f} AUD."
        )

    itinerary["budget_breakdown"] = budget

    itinerary["trip"]["total_cost_aud"] = (
        budget["total_aud"]
    )

    # ------------------------------------------------------------
    # Budget check
    # ------------------------------------------------------------

    requested_budget = params.get(
        "budget_aud"
    )

    if requested_budget:

        if budget["total_aud"] > requested_budget:

            warnings.append(
                f"Estimated cost is "
                f"{budget['total_aud']:.2f} AUD, "
                f"which exceeds the requested "
                f"budget of "
                f"{requested_budget:.2f} AUD."
            )

        else:

            remaining = (
                requested_budget
                - budget["total_aud"]
            )

            warnings.append(
                f"Estimated cost is "
                f"{budget['total_aud']:.2f} AUD; "
                f"approximately "
                f"{remaining:.2f} AUD "
                f"remains within the requested budget."
            )

    # ------------------------------------------------------------
    # Budget theme check
    # ------------------------------------------------------------

    if params["theme"] == "budget":

        for hotel in valid_hotels:

            stars = pd.to_numeric(
                hotel.get(
                    "star_rating",
                    0,
                ),
                errors="coerce",
            )

            if not pd.isna(stars) and stars >= 4.5:

                warnings.append(
                    "Budget theme requested, but only "
                    "high-rated/luxury hotel inventory "
                    "was available. The cheapest "
                    "available suitable hotel was selected."
                )

                break

    # ------------------------------------------------------------
    # Bookability
    # ------------------------------------------------------------

    bookable = (
        len(errors) == 0
        and outbound_found
        and return_found
        and bool(valid_hotels)
        and actual_days == expected_days
    )

    # ------------------------------------------------------------
    # Validity
    #
    # IMPORTANT:
    #
    # valid = itinerary logically complete
    #
    # Missing required flight = invalid.
    #
    # Therefore:
    #
    # valid=False
    # bookable=False
    # ------------------------------------------------------------

    is_valid = (
        len(errors) == 0
        and outbound_found
        and return_found
        and bool(valid_hotels)
        and actual_days == expected_days
    )

    if not bookable:

        warnings.append(
            "Flight or accommodation inventory is incomplete; "
            "this itinerary is a draft and cannot be fully booked."
        )

    itinerary["validation"] = {
        "is_valid": is_valid,
        "bookable": bookable,
        "warnings": list(
            dict.fromkeys(warnings)
        ),
        "errors": list(
            dict.fromkeys(errors)
        ),
    }

    # Explicit top-level bookable flag.
    itinerary["bookable"] = bookable

    return itinerary


# ============================================================================
# DETERMINISTIC FALLBACK
# ============================================================================

def build_fallback_itinerary(
    params: dict,
    inventory: dict,
    reason: str,
) -> dict:

    duration_days = max(
        1,
        int(
            params.get(
                "duration_days",
                1,
            )
        ),
    )

    destinations = (
        params.get(
            "destinations"
        )
        or ["Tokyo"]
    )

    city = destinations[0]

    # ------------------------------------------------------------
    # Start date
    # ------------------------------------------------------------

    start_date = datetime(
        int(
            params.get(
                "travel_year",
                DEFAULT_TRAVEL_YEAR,
            )
        ),
        4,
        1,
    ).date()

    # ------------------------------------------------------------
    # Flights
    # ------------------------------------------------------------

    flights = []

    outbound = inventory.get(
        "outbound_flight_options",
        []
    )

    inbound = inventory.get(
        "inbound_flight_options",
        []
    )

    if outbound:

        selected = dict(
            outbound[0]
        )

        selected["leg"] = "outbound"

        flights.append(
            selected
        )

        departure = selected.get(
            "departure_datetime"
        )

        if departure:

            try:

                start_date = datetime.strptime(
                    str(departure),
                    "%Y-%m-%d %H:%M",
                ).date()

            except ValueError:
                pass

    if inbound:

        selected = dict(
            inbound[0]
        )

        selected["leg"] = "return"

        flights.append(
            selected
        )

    # ------------------------------------------------------------
    # Hotel
    # ------------------------------------------------------------

    accommodation = []

    hotels = inventory.get(
        "hotel_options",
        {}
    ).get(
        city,
        []
    )

    if hotels:

        hotel = dict(
            hotels[0]
        )

        nights = max(
            1,
            duration_days - 1,
        )

        nightly = float(
            hotel.get(
                "price_per_night_aud",
                0,
            )
        )

        accommodation.append(
            {
                **hotel,
                "nights": nights,
                "total_price_aud": round(
                    nightly * nights,
                    2,
                ),
                "check_in": str(
                    start_date
                ),
                "check_out": str(
                    start_date
                    + timedelta(
                        days=nights
                    )
                ),
            }
        )

    # ------------------------------------------------------------
    # Activities
    # ------------------------------------------------------------

    activities = inventory.get(
        "activity_options",
        {}
    ).get(
        city,
        []
    )

    days = []

    for index in range(
        duration_days
    ):

        day_date = (
            start_date
            + timedelta(
                days=index
            )
        )

        day_activities = []

        if activities:

            activity = activities[
                index % len(activities)
            ]

            day_activities.append(
                {
                    "activity_id": activity.get(
                        "activity_id"
                    ),
                    "activity_name": activity.get(
                        "activity_name"
                    ),
                    "category": activity.get(
                        "category"
                    ),
                    "start_time": "10:00",
                    "duration_hours": float(
                        activity.get(
                            "duration_hours",
                            2,
                        )
                    ),
                    "price_aud": float(
                        activity.get(
                            "price_aud",
                            0,
                        )
                    ),
                    "rating": float(
                        activity.get(
                            "rating",
                            0,
                        )
                    ),
                    "notes": (
                        "Draft activity selected "
                        "from available inventory."
                    ),
                }
            )

        days.append(
            {
                "day_number": index + 1,
                "date": str(day_date),
                "city": city,
                "title": (
                    "Arrival & Orientation"
                    if index == 0
                    else f"{city} Day {index + 1}"
                ),
                "description": (
                    "Draft itinerary generated "
                    "from available inventory."
                ),
                "activities": day_activities,
            }
        )

    itinerary = {
        "meta": {
            "trip_id": str(
                uuid.uuid4()
            ),
            "created_at": datetime.now(
                timezone.utc
            ).isoformat(
                timespec="seconds"
            ).replace(
                "+00:00",
                "Z",
            ),
            "version": "1.0",
        },

        "trip": {
            "title": (
                f"Draft {duration_days}-Day "
                f"{city} Itinerary"
            ),
            "destination_cities": destinations,
            "duration_days": duration_days,
            "theme": params.get(
                "theme",
                "culture",
            ),
            "travel_dates": {
                "depart_date": str(
                    start_date
                ),
                "return_date": str(
                    start_date
                    + timedelta(
                        days=duration_days - 1
                    )
                ),
            },
            "total_cost_aud": 0,
            "currency": "AUD",
            "group_size": params.get(
                "group_size",
                1,
            ),
            "status": "draft",
        },

        "description": (
            "Draft itinerary generated from "
            "available inventory because the "
            "LLM was unavailable."
        ),

        "flights": flights,

        "accommodation": accommodation,

        "days": days,

        "budget_breakdown": {},

        "validation": {
            "is_valid": False,
            "bookable": False,
            "warnings": [
                f"LLM fallback used: {reason}"
            ],
            "errors": [],
        },

        "bookable": False,
    }

    return itinerary


# ============================================================================
# ERROR HELPERS
# ============================================================================

def summarize_llm_error(
    error_text: str,
) -> str:

    if not error_text:
        return "Unknown LLM error."

    text = error_text.strip()

    # HTTP errors
    match = re.search(
        r"Gemini HTTP (\d+)",
        text,
        re.IGNORECASE,
    )

    if match:

        code = match.group(1)

        if code == "503":
            return (
                "Gemini temporarily unavailable "
                "(HTTP 503)."
            )

        if code == "429":
            return (
                "Gemini rate limit reached "
                "(HTTP 429)."
            )

        return (
            f"Gemini HTTP error {code}."
        )

    first_line = text.splitlines()[0]

    return first_line[:300]


# ============================================================================
# STEP 6 — MAIN ORCHESTRATOR
# ============================================================================

def generate_itinerary(
    user_input: str,
    origin_city: str = DEFAULT_ORIGIN,
    verbose: bool = False,
) -> dict:
    t_all_start = time.perf_counter()

    # ================================================================
    # 1. PARSE
    # ================================================================

    if verbose:

        print(
            "\n[1/6] Parsing request:"
        )

        print(
            f"      {user_input}"
        )

    params = parse_user_request(
        user_input,
        origin_city,
    )

    if verbose:

        print(
            f"      theme={params['theme']}"
        )

        print(
            f"      destinations={params['destinations']}"
        )

        print(
            f"      days={params['duration_days']}"
        )

        print(
            f"      budget={params['budget_aud']}"
        )

        print(
            f"      group_size={params['group_size']}"
        )

    # ================================================================
    # 2. INVENTORY
    # ================================================================

    if verbose:

        print(
            "\n[2/6] Querying inventory..."
        )

 
    t_inv_start = time.perf_counter()

    inventory = query_inventory(
        params
    )

    t_inv = time.perf_counter() - t_inv_start

    # ================================================================
    # 3. PROMPT
    # ================================================================

    if verbose:

        print(
            "\n[3/6] Building AI prompt..."
        )

    t_prompt_start = time.perf_counter()

    user_prompt = build_ai_prompt(
        params,
        inventory,
    )

    t_prompt = time.perf_counter() - t_prompt_start

    if verbose:

        print(
            f"      prompt_length="
            f"{len(user_prompt)} chars"
        )

    # ================================================================
    # 4. GEMINI
    # ================================================================

    if verbose:

        print(
            "\n[4/6] Calling Gemini..."
        )

    itinerary = None
    failure_reason = None

    parse_guidance = ""

    t_llm_start = time.perf_counter()
    raw = ""

    for attempt in range(
        1,
        MAX_LLM_ATTEMPTS + 1,
    ):
       
        if verbose:

            print(
                f"      Attempt "
                f"{attempt}/"
                f"{MAX_LLM_ATTEMPTS}"
            )

        try:

            attempt_llm_start = time.perf_counter()
            raw = call_llm(
                SYSTEM_PROMPT,
                user_prompt
                + parse_guidance,
            )
             
            t_llm = time.perf_counter() - attempt_llm_start


        except Exception as exc:

            failure_reason = summarize_llm_error(
                str(exc)
            )

            # Always logged, not just when verbose: a silent fallback to the
            # draft itinerary looks like success and hides the real cause.
            print(
                f"      [llm] attempt {attempt}/{MAX_LLM_ATTEMPTS} "
                f"failed: {failure_reason}"
            )

            # Retry temporary failures.
            if attempt < MAX_LLM_ATTEMPTS:

                # Back off first. Retrying instantly against a per-minute
                # quota just earns another rejection.
                is_rate_limit = (
                    "429" in failure_reason
                    or "rate limit" in failure_reason.lower()
                    or "quota" in failure_reason.lower()
                )

                delay = 20 * attempt if is_rate_limit else 2 * attempt

                print(f"      [llm] waiting {delay}s before retry")

                time.sleep(delay)

                continue

            break

        if verbose:

            print(
                f"      response_length="
                f"{len(raw)} chars"
            )
       
        

        try:

            t_parse_start = time.perf_counter()
            itinerary = parse_llm_response(
                raw
            )
            t_parse = time.perf_counter() - t_parse_start
            # Inventory wins over the model on every factual field.
            itinerary = _enrich_from_inventory(
                itinerary, inventory
            )

            if verbose:

                print(
                    "      ✓ Valid JSON received."
                )

            break

        except json.JSONDecodeError as exc:

            failure_reason = (
                f"Invalid JSON: {exc}"
            )

            # Always logged. Truncation from the output-token cap shows up
            # here, and the length says whether that is what happened.
            print(
                f"      [llm] attempt {attempt}/{MAX_LLM_ATTEMPTS} "
                f"bad JSON ({len(raw)} chars): {exc}"
            )

            if attempt < MAX_LLM_ATTEMPTS:

                parse_guidance = """
IMPORTANT:
Your previous response was invalid JSON.

Return ONLY one complete JSON object.

Do not use markdown.
Do not use code fences.
Do not truncate the response.
Do not add comments.
Do not add text before or after the JSON.
"""

                continue

            break


    # ================================================================
    # TIMING
    # ================================================================

    t_llm = time.perf_counter() - t_llm_start
    t_all = time.perf_counter() - t_all_start

    print(
        f"[timing] "
        f"inventory={t_inv:.1f}s "
        f"prompt={t_prompt:.1f}s "
        f"llm={t_llm:.1f}s "
        f"parse={t_parse:.1f}s "
        f"total={t_all:.1f}s "
        f"out_chars={len(raw)} "
        f"attempts={attempt}"
    )

    # ================================================================
    # 5. FALLBACK
    # ================================================================

    if itinerary is None:

        if verbose:

            print(
                "\n[5/6] Using deterministic fallback..."
            )

        itinerary = build_fallback_itinerary(
            params,
            inventory,
            failure_reason
            or "LLM response unavailable.",
        )

    else:

        if verbose:

            print(
                "\n[5/6] Validating AI itinerary..."
            )

    # ================================================================
    # 6. HARD VALIDATION + DETERMINISTIC COST
    # ================================================================

    itinerary = validate_itinerary(
        itinerary,
        params,
        inventory,
    )

    # ------------------------------------------------------------
    # Ensure metadata
    # ------------------------------------------------------------

    itinerary.setdefault(
        "meta",
        {}
    )

    if not itinerary["meta"].get(
        "trip_id"
    ):

        itinerary["meta"][
            "trip_id"
        ] = str(
            uuid.uuid4()
        )

    itinerary["meta"].setdefault(
        "version",
        "1.0",
    )

    itinerary["meta"].setdefault(
        "created_at",
        datetime.now(
            timezone.utc
        ).isoformat(
            timespec="seconds"
        ).replace(
            "+00:00",
            "Z",
        ),
    )

    # ------------------------------------------------------------
    # Final output diagnostics
    # ------------------------------------------------------------

    if verbose:

        validation = itinerary[
            "validation"
        ]

        print(
            "\n[6/6] Validation complete."
        )

        print(
            f"      valid="
            f"{validation['is_valid']}"
        )

        print(
            f"      bookable="
            f"{validation['bookable']}"
        )

        print(
            f"      warnings="
            f"{len(validation['warnings'])}"
        )

        print(
            f"      errors="
            f"{len(validation['errors'])}"
        )

        for warning in validation[
            "warnings"
        ]:

            print(
                f"      ⚠ {warning}"
            )

        for error in validation[
            "errors"
        ]:

            print(
                f"      ✗ {error}"
            )

    return itinerary


# ============================================================================
# CLI
# ============================================================================

if __name__ == "__main__":

    import sys

    if len(sys.argv) > 1:

        request = " ".join(
            sys.argv[1:]
        )

    else:

        request = (
            "5 days Japan for 2 people, "
            "budget $8000 AUD"
        )

    result = generate_itinerary(
        request,
        origin_city=DEFAULT_ORIGIN,
        verbose=True,
    )

    print(
        "\n================ RESULT ================"
    )

    print(
        json.dumps(
            result,
            indent=2,
            ensure_ascii=False,
            default=str,
        )
    )