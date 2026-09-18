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

# Keep retries inside the browser/Next.js request window.  The web proxy
# gives /api/ai/recommend roughly 120 seconds; leaving headroom for
# inventory loading, validation, and serialization prevents a late 504.
MAX_LLM_ATTEMPTS = 2
MAX_JSON_ATTEMPTS = 2
LLM_REQUEST_BUDGET_SECONDS = float(
    os.environ.get("ITINERARY_REQUEST_BUDGET_SECONDS", "100")
)
LLM_MIN_RETRY_SECONDS = float(
    os.environ.get("ITINERARY_MIN_RETRY_SECONDS", "20")
)

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
    # [^(]* rather than (.*?)\s* : the latter overlaps with \s* and
    # backtracks polynomially on long whitespace runs (CodeQL).
    match = re.match(r"^([^(]*)\(([A-Za-z]{3})\)\s*$", text)

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
# AIRPORT TIMEZONES AND GROUND TRANSFER
# ============================================================================
#
# Flight timestamps in Supabase are true UTC (verified against real elapsed
# durations). The model reasons in whatever it is shown, so a UTC arrival of
# 18:00 was read as an evening arrival when it is 03:00 next morning in
# Tokyo - which is how day 1 ended up with a sunset cruise booked before the
# traveller had landed.
#
# Local times are computed here so the model never does timezone arithmetic.

AIRPORT_TIMEZONES = {
    "SYD": "Australia/Sydney", "MEL": "Australia/Melbourne",
    "BNE": "Australia/Brisbane", "PER": "Australia/Perth",
    "CNS": "Australia/Brisbane", "AKL": "Pacific/Auckland",
    "ZQN": "Pacific/Auckland", "NRT": "Asia/Tokyo", "HND": "Asia/Tokyo",
    "KIX": "Asia/Tokyo", "ITM": "Asia/Tokyo", "UKY": "Asia/Tokyo",
    "CTS": "Asia/Tokyo", "ICN": "Asia/Seoul", "GMP": "Asia/Seoul",
    "PUS": "Asia/Seoul", "TPE": "Asia/Taipei", "HKG": "Asia/Hong_Kong",
    "PVG": "Asia/Shanghai", "SIN": "Asia/Singapore", "BKK": "Asia/Bangkok",
    "DMK": "Asia/Bangkok", "CNX": "Asia/Bangkok", "HKT": "Asia/Bangkok",
    "KUL": "Asia/Kuala_Lumpur", "DPS": "Asia/Makassar", "CGK": "Asia/Jakarta",
    "MNL": "Asia/Manila", "HAN": "Asia/Ho_Chi_Minh", "SGN": "Asia/Ho_Chi_Minh",
    "DAD": "Asia/Ho_Chi_Minh", "DEL": "Asia/Kolkata", "BOM": "Asia/Kolkata",
    "CMB": "Asia/Colombo", "DXB": "Asia/Dubai", "DOH": "Asia/Qatar",
    "CAI": "Africa/Cairo", "RAK": "Africa/Casablanca",
    "CPT": "Africa/Johannesburg", "NBO": "Africa/Nairobi",
    "LHR": "Europe/London", "LGW": "Europe/London", "STN": "Europe/London",
    "LTN": "Europe/London", "EDI": "Europe/London", "CDG": "Europe/Paris",
    "ORY": "Europe/Paris", "NCE": "Europe/Paris", "AMS": "Europe/Amsterdam",
    "BER": "Europe/Berlin", "VIE": "Europe/Vienna", "PRG": "Europe/Prague",
    "KRK": "Europe/Warsaw", "ZRH": "Europe/Zurich", "FCO": "Europe/Rome",
    "CIA": "Europe/Rome", "FLR": "Europe/Rome", "VCE": "Europe/Rome",
    "BCN": "Europe/Madrid", "MAD": "Europe/Madrid", "VLC": "Europe/Madrid",
    "LIS": "Europe/Lisbon", "OPO": "Europe/Lisbon", "ATH": "Europe/Athens",
    "JTR": "Europe/Athens", "IST": "Europe/Istanbul", "SAW": "Europe/Istanbul",
    "KEF": "Atlantic/Reykjavik", "JFK": "America/New_York",
    "EWR": "America/New_York", "LGA": "America/New_York",
    "YYZ": "America/Toronto", "LAX": "America/Los_Angeles",
    "SFO": "America/Los_Angeles", "YVR": "America/Vancouver",
    "HNL": "Pacific/Honolulu", "CUN": "America/Cancun",
    "MEX": "America/Mexico_City", "EZE": "America/Argentina/Buenos_Aires",
    "GIG": "America/Sao_Paulo", "CUZ": "America/Lima", "MDE": "America/Bogota",
}

# Fallbacks, used only when the model gives no usable estimate. The model is
# asked to estimate the real airport-to-city time, because a flat constant
# treats Osaka-Kyoto (about 75 minutes) the same as a genuine four-hour haul.
DIRECT_TRANSFER_HOURS = 2.0
GATEWAY_TRANSFER_HOURS = 4.0

# Bounds on the model's estimate. Anything outside this is discarded in
# favour of the fallback: a transfer of four minutes or eleven hours is a
# mistake, not a measurement, and it feeds a hard scheduling decision.
MIN_TRANSFER_MINUTES = 20
MAX_TRANSFER_MINUTES = 420

# Hotel to airport before the flight home: check-in, security, the ride out.
DEPARTURE_TRANSFER_HOURS = 3.0

# Nothing worth starting after this hour.
LATEST_USEFUL_START = 18.0


def _iata_of(value) -> str:
    """Pull the three-letter code out of "Tokyo (NRT)" or a bare "NRT"."""

    if value is None:
        return ""

    text = str(value).strip()
    match = re.search(r"\(([A-Za-z]{3})\)\s*$", text)

    if match:
        return match.group(1).upper()

    if re.fullmatch(r"[A-Za-z]{3}", text):
        return text.upper()

    codes = AIRPORT_CODES.get(normalize_city(text))

    return codes[0] if codes else ""


def _local_time(utc_value, airport) -> str:
    """
    A UTC timestamp rendered in the airport's local time, "YYYY-MM-DD HH:MM".

    Returns "" for an unknown airport rather than guessing, so a gap shows as
    nothing instead of a wrong time.
    """

    zone_name = AIRPORT_TIMEZONES.get(_iata_of(airport))

    if not zone_name or utc_value in (None, ""):
        return ""

    try:
        from zoneinfo import ZoneInfo

        stamp = pd.to_datetime(utc_value, utc=True, errors="coerce")

        if pd.isna(stamp):
            return ""

        return stamp.tz_convert(ZoneInfo(zone_name)).strftime("%Y-%m-%d %H:%M")

    except Exception:                                   # noqa: BLE001
        return ""


def _transfer_hours(airport, destination_city: str) -> float:
    """
    How long from the plane door to the hotel.

    Two hours when the flight lands in the destination city itself, four when
    it lands somewhere else and the traveller continues overland.
    """

    landed_in = normalize_city(airport)

    return (
        DIRECT_TRANSFER_HOURS
        if landed_in and landed_in == normalize_city(destination_city)
        else GATEWAY_TRANSFER_HOURS
    )


def _add_local_times(records: list, destination_city: str = "") -> list:
    """Annotate flight records with local times and the transfer allowance."""

    for record in records:

        record["departure_local"] = _local_time(
            record.get("departure_datetime"),
            record.get("origin"),
        )

        record["arrival_local"] = _local_time(
            record.get("arrival_datetime"),
            record.get("destination"),
        )

        if destination_city:

            hours = _transfer_hours(
                record.get("destination"),
                destination_city,
            )

            record["transfer_hours_to_destination"] = hours

            record["is_direct_to_destination"] = (
                hours == DIRECT_TRANSFER_HOURS
            )

    return records


def _clock_to_hours(value) -> float:
    """'14:30' -> 14.5. Returns -1.0 when unparseable."""

    match = re.match(r"^\s*(\d{1,2}):(\d{2})", str(value or ""))

    return -1.0 if not match else int(match.group(1)) + int(match.group(2)) / 60.0


def _hours_to_clock(value: float) -> str:
    """14.5 -> '14:30', clamped to a valid 24-hour time."""

    value = max(0.0, min(23.98, value))
    hours = int(value)
    minutes = int(round((value - hours) * 60))

    if minutes >= 60:
        hours, minutes = hours + 1, 0

    return f"{hours:02d}:{minutes:02d}"

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
        # Bounded {1,4}: unbounded \d+ is retried from every start
        # position, which CodeQL flags as polynomial backtracking.
        r"(\d{1,4})\s*(day|days|night|nights|week|weeks)",
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
        r"(\d{1,4})\s*(?:people|person|travellers?|travelers?|adults?|pax)",
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
    not_before=None,
    not_after=None,
) -> pd.DataFrame:

    mask = _route_matches(
        flights_df,
        origin,
        destination,
    )

    candidates = flights_df[mask].copy()

    if candidates.empty:
        return candidates

    # ------------------------------------------------------------
    # Date window
    #
    # Without this the cheapest five flights on a route win regardless of
    # date, so the return leg could depart three hours after the outbound,
    # or months before it. Falls back to the unfiltered set rather than
    # returning nothing, so a thin route still produces a draft.
    # ------------------------------------------------------------

    if (
        (not_before is not None or not_after is not None)
        and "departure_datetime" in candidates.columns
    ):

        def _utc(value):
            stamp = pd.Timestamp(value)

            return (
                stamp.tz_localize("UTC")
                if stamp.tzinfo is None
                else stamp.tz_convert("UTC")
            )

        departures = pd.to_datetime(
            candidates["departure_datetime"],
            errors="coerce",
            utc=True,
        )

        window = pd.Series(True, index=candidates.index)

        if not_before is not None:
            window &= departures >= _utc(not_before)

        if not_after is not None:
            window &= departures <= _utc(not_after)

        candidates = candidates[window]
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


# ============================================================================
# GATEWAY SELECTION
# ============================================================================
#
# Only 43 of the 68 destination cities appear in the flights table at all.
# Asking for a direct flight to Kyoto returns nothing, so the itinerary came
# back with no flights and the editor had nothing to show.
#
# Real travel does not work that way: you fly to the nearest airport with
# service and continue overland. The choice of which airport is geography,
# which the model knows and the database does not, so it is asked - but the
# answer is checked against cities that actually have flights, so it cannot
# invent one.

def _cities_reachable_from(flights_df, origin: str) -> list:
    """Destination cities with at least one flight from the origin."""

    served = flights_df[
        flights_df["origin_city_normalized"].eq(normalize_city(origin))
    ]["destination_city_normalized"]

    return sorted({c for c in served.dropna().unique() if c})


def _cities_flying_to(flights_df, target: str) -> list:
    """Origin cities with at least one flight to the target."""

    served = flights_df[
        flights_df["destination_city_normalized"].eq(normalize_city(target))
    ]["origin_city_normalized"]

    return sorted({c for c in served.dropna().unique() if c})


def _choose_gateway_city(
    flights_df,
    origin: str,
    destination: str,
    country: str,
    verbose: bool = False,
    reverse: bool = False,
    target_origin: str = "",
) -> str:
    """
    The best airport city to reach `destination` when it has no direct
    service, or "" if nothing sensible is available.

    Tries, in order:
      1. the same-country city with the most flights - a fact in the data
      2. the model's pick, accepted only if it names a city that really has
         flights, for the cases where the country offers nothing
      3. nothing, which leaves the itinerary flightless as before

    Only called when a flight search has already come back empty. A route
    that exists is always used as-is.
    """

    # reverse=True asks the mirrored question: not "where can I fly from
    # Sydney", but "which nearby city can fly me back to Sydney". Needed when
    # the outbound was fine and only the return leg is missing.
    candidates = (
        _cities_flying_to(flights_df, target_origin or origin)
        if reverse
        else _cities_reachable_from(flights_df, origin)
    )

    if not candidates:
        return ""

    # ---- computed first so it is available to every path below
    same_country = []

    if country:
        if reverse:
            in_country = flights_df[
                flights_df["origin_country"]
                .astype(str)
                .str.strip()
                .str.lower()
                .eq(str(country).strip().lower())
                & flights_df["destination_city_normalized"].eq(
                    normalize_city(target_origin or origin)
                )
            ]

            same_country = (
                in_country["origin_city_normalized"]
                .value_counts()
                .index.tolist()
            )

        else:
            in_country = flights_df[
                flights_df["destination_country"]
                .astype(str)
                .str.strip()
                .str.lower()
                .eq(str(country).strip().lower())
                & flights_df["origin_city_normalized"].eq(
                    normalize_city(origin)
                )
            ]

            same_country = (
                in_country["destination_city_normalized"]
                .value_counts()
                .index.tolist()
            )

    fallback = next(
        (c for c in same_country if c and c != normalize_city(destination)),
        "",
    )

    # ---- 1. same country wins outright when one is available.
    #
    # Being in the same country is a fact in the data; "which airport is
    # nearest" is a judgement. Asking the model first let it answer Santorini
    # for Florence when Rome was sitting right there. The model is now only
    # consulted when the country offers nothing.
    if fallback:

        if verbose:
            print(f"      gateway: {fallback} (same country as {destination})")

        return fallback

    # ---- 2. no same-country option, so ask the model
    try:
        answer = _llm_call(
            "You are a travel routing assistant. Answer with one city name "
            "from the supplied list and nothing else. No punctuation, no "
            "explanation.",
            (
                f"A traveller is in {destination}"
                f"{', ' + country if country else ''} and needs to fly to "
                f"{target_origin}.\n"
                f"There is no service from {destination} itself.\n\n"
                "Which ONE of these cities is the most practical airport to "
                "travel to overland and fly out from?\n\n"
                if reverse else
                f"A traveller wants to reach {destination}"
                f"{', ' + country if country else ''}.\n"
                f"There is no airport service to {destination} itself.\n\n"
                "Which ONE of these cities is the most practical airport to "
                "fly into and continue overland from?\n\n"
                + ", ".join(candidates)
                + "\n\nReply with exactly one name from that list."
            ),
            max_tokens=200,
        ).text

        picked = (answer or "").strip().strip(".").strip()

        # A pick in the destination's own country beats one abroad, whatever
        # the model says: it chose Santorini as the gateway for Florence when
        # Rome was in the list. Same country is a far better proxy for
        # "reachable overland" than anything it can infer from a bare list.
        if fallback and picked.lower() not in {c.lower() for c in same_country}:

            if verbose:
                print(
                    f"      gateway: model said {picked!r}, but {fallback} is "
                    f"in {country}; using {fallback}"
                )

            return fallback

        # Exact match first.
        for candidate in candidates:
            if candidate.lower() == picked.lower():

                if verbose:
                    print(f"      gateway: model chose {candidate}")

                return candidate

        # Then a whole-word match, for when it answers in a sentence despite
        # being told not to. Longest first so "New York" wins over "York".
        for candidate in sorted(candidates, key=len, reverse=True):
            if re.search(
                rf"\b{re.escape(candidate)}\b",
                picked,
                re.IGNORECASE,
            ):

                if verbose:
                    print(
                        f"      gateway: model chose {candidate} "
                        f"(from {picked!r})"
                    )

                return candidate

        if verbose:
            print(
                f"      gateway: model said {picked!r}, not in the served "
                f"list; using {fallback or 'nothing'}"
            )

    except Exception as exc:                                # noqa: BLE001
        if verbose:
            print(f"      gateway: model call failed ({exc}); using fallback")

    return fallback

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

    # No direct service. Fall back to the nearest airport with flights and let
    # the traveller continue overland - the transfer allowance downstream
    # already accounts for that leg.
    gateway_city = ""
    return_gateway_city = ""

    _return_country = ""

    if "country" in activities_df.columns:
        _dest_rows = activities_df[
            activities_df["city_normalized"].eq(destinations[-1])
        ]
        if not _dest_rows.empty:
            _return_country = str(_dest_rows["country"].iloc[0])

    if outbound.empty:

        _country = ""

        if "country" in activities_df.columns:
            _rows = activities_df[
                activities_df["city_normalized"].eq(destinations[0])
            ]
            if not _rows.empty:
                _country = str(_rows["country"].iloc[0])

        gateway_city = _choose_gateway_city(
            flights_df,
            origin,
            destinations[0],
            _country,
        )

        if gateway_city:

            outbound = _select_best_flights(
                flights_df,
                origin,
                gateway_city,
                cabin_preference,
                group_size,
            )

            if not outbound.empty:
                print(
                    f"      gateway: no service to {destinations[0]}; "
                    f"flying into {gateway_city} instead"
                )
            else:
                gateway_city = ""

    # ------------------------------------------------------------
    # RETURN
    # ------------------------------------------------------------

    # Anchor the return to the outbound, targeting the length the traveller
    # asked for. Without this the cheapest return on the route wins whatever
    # its date, which is how a 6-day Singapore trip came back with a return
    # departing three hours after the outbound.
    #
    # duration_days counts days on the ground, so the return is
    # duration_days - 1 nights after arrival. One day either side absorbs
    # overnight legs and thin routes.
    _return_from = None
    _return_to = None

    if not outbound.empty and "arrival_datetime" in outbound.columns:

        _anchor = pd.to_datetime(
            outbound["arrival_datetime"],
            errors="coerce",
            utc=True,
        ).min()

        if pd.notna(_anchor):

            _target = max(1, duration_days - 1)

            _return_from = _anchor + pd.Timedelta(days=max(1, _target - 1))
            _return_to = _anchor + pd.Timedelta(days=_target + 1)

    _return_from_city = gateway_city or destinations[-1]

    inbound = _select_best_flights(
        flights_df,
        _return_from_city,
        origin,
        cabin_preference,
        group_size,
        not_before=_return_from,
        not_after=_return_to,
    )

    # The return can be missing even when the outbound was fine: a route can
    # run one way only, or nothing sits inside the date window. Look for a
    # gateway for the way home too, rather than leaving the traveller
    # stranded with a one-way itinerary.
    if inbound.empty:

        _home_gateway = _choose_gateway_city(
            flights_df,
            _return_from_city,
            _return_from_city,
            _return_country,
            reverse=True,
            target_origin=origin,
        )

        if _home_gateway and _home_gateway != _return_from_city:

            inbound = _select_best_flights(
                flights_df,
                _home_gateway,
                origin,
                cabin_preference,
                group_size,
                not_before=_return_from,
                not_after=_return_to,
            )

            if not inbound.empty:
                return_gateway_city = _home_gateway
                print(
                    f"      gateway: no return from {_return_from_city}; "
                    f"flying home from {_home_gateway} instead"
                )

    # Widen the window in steps rather than removing it. Dropping it outright
    # took a return nine months after the outbound, and the itinerary became
    # 273 days long. A return on a slightly wrong date is useful; one on a
    # wildly wrong date is worse than none.
    if inbound.empty and _return_from is not None:

        for _slack_days in (3, 7, 14):

            inbound = _select_best_flights(
                flights_df,
                return_gateway_city or _return_from_city,
                origin,
                cabin_preference,
                group_size,
                not_before=_return_from - pd.Timedelta(days=_slack_days),
                not_after=_return_to + pd.Timedelta(days=_slack_days),
            )

            if not inbound.empty:
                print(
                    f"      gateway: no return on the exact dates; took one "
                    f"within {_slack_days} days"
                )
                break

        else:
            print(
                "      gateway: no return within two weeks of the trip; "
                "leaving the itinerary one-way"
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

    # ------------------------------------------------------------
    # Flight availability
    #
    # A structured field so the frontend can branch on it directly instead of
    # matching strings in validation.warnings. Set here because this is the
    # only place that knows whether a gateway was used and which one.
    # ------------------------------------------------------------

    _availability = {
        "outbound_available": not outbound.empty,
        "return_available": not inbound.empty,
        "requested_city": destinations[0],
        "outbound_via": gateway_city or None,
        "return_via": return_gateway_city or (gateway_city or None),
        "message": "",
    }

    if outbound.empty and inbound.empty:
        _availability["message"] = (
            f"No flights available to or from {destinations[0]}, and no "
            "nearby airport with service. Add flights manually before "
            "publishing."
        )

    elif outbound.empty:
        _availability["message"] = (
            f"No outbound flight to {destinations[0]} or any nearby airport."
        )

    elif inbound.empty:
        _availability["message"] = (
            f"No return flight from {destinations[-1]} or any nearby airport "
            "within two weeks of the trip."
        )

    elif gateway_city or return_gateway_city:
        _via = gateway_city or return_gateway_city
        _availability["message"] = (
            f"No direct service to {destinations[0]}. Flying via {_via}; "
            "the onward transfer is not included in the package."
        )

    # Local clock times plus the airport-to-hotel allowance, so the model
    # plans against what the traveller experiences rather than UTC.
    _dest_city = destinations[0]
    _origin_city = origin

    return {
        "outbound_flight_options": _add_local_times(
            outbound.to_dict(orient="records"),
            _dest_city,
        ),
        "inbound_flight_options": _add_local_times(
            inbound.to_dict(orient="records"),
            _origin_city,
        ),
        "inter_city_legs": inter_city_legs,
        "flight_availability": _availability,
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

1. Return ONLY one valid JSON object. Before sending it, verify every field and array element is comma-separated and the JSON is syntactically complete.
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



def _travel_window_block(params: dict, inventory: dict) -> str:
    """
    The travel window in plain local time, at the very top of the prompt.

    Flight times are otherwise buried in JSON arrays further down, and the
    model was reading the UTC fields. Stating the window first gives it the
    constraint before it starts planning rather than after.

    The airport-to-city transfer is NOT computed here. We have no transfer
    inventory, and a flat constant treats Osaka-Kyoto the same as a genuine
    four-hour haul, so the model is asked to estimate it from what it knows
    about the route. The estimate comes back in the response and is bounds-
    checked before anything is scheduled against it.
    """

    outbound = (inventory.get("outbound_flight_options") or [None])[0]
    inbound = (inventory.get("inbound_flight_options") or [None])[0]
    city = (params.get("destinations") or ["the destination"])[0]

    lines = [
        "============================================================",
        "TRAVEL WINDOW - READ BEFORE PLANNING ANYTHING",
        "============================================================",
        "",
        "All times are LOCAL clock times. Plan inside this window.",
        "",
    ]

    if not outbound:
        lines += [
            "No outbound flight is available for this route. Plan activities",
            "only. Do not invent a flight.",
            "============================================================",
        ]
        return "\n".join(lines)

    arrive = outbound.get("arrival_local") or ""
    direct = bool(outbound.get("is_direct_to_destination"))

    lines += [
        f"  Depart {outbound.get('origin', '?')}   "
        f"{outbound.get('departure_local') or 'unknown'}",
        f"  Land   {outbound.get('destination', '?')}   "
        f"{arrive or 'unknown'}",
    ]

    if arrive:
        lines += ["", f"DAY 1 IS {arrive[:10]} - the date you LAND, not the "
                      "date you take off."]

    # ------------------------------------------------------------
    # Step 1 - the model estimates the transfer
    # ------------------------------------------------------------

    lines += [
        "",
        "STEP 1 - ESTIMATE THE TRANSFER",
        "",
        f"Estimate the usual door-to-door time from "
        f"{outbound.get('destination', 'the arrival airport')} to central "
        f"{city}, by the way most travellers actually make that trip.",
        "",
        "Include immigration, baggage and the journey itself. Use what you",
        f"know about this specific route - {outbound.get('destination', '?')}",
        f"to {city} - not a generic figure.",
    ]

    if not direct:
        lines += [
            "",
            f"  NOTE: this flight does not land in {city}. The traveller",
            "  continues overland. We do not sell that leg, so mention it in",
            "  the day 1 description but never as a booked item.",
        ]

    if inbound:
        lines += [
            "",
            f"Also estimate the time from central {city} out to "
            f"{inbound.get('origin', 'the departure airport')}, including",
            "check-in and security before the flight home.",
        ]

    lines += [
        "",
        "Report both in arrival_transfer and departure_transfer in your",
        "response. They are checked against the schedule you produce.",
        "",
        "STEP 2 - APPLY THEM",
        "",
        f"Add your arrival estimate to the landing time ({arrive[11:16] or '?'}"
        " local) to get the hour the traveller is first free on day 1.",
        "",
        "  - If that is after about 18:00, day 1 has NO activities. Describe",
        "    it as an arrival and rest day. An empty first day is correct",
        "    after a long flight, not a gap to fill.",
        "  - If there is time left, schedule nothing before that hour, and",
        "    keep day 1 light. They have just got off a plane.",
    ]

    if inbound and (inbound.get("departure_local") or ""):

        home = inbound["departure_local"]

        lines += [
            "",
            f"THE LAST DAY IS {home[:10]}. The flight home leaves "
            f"{inbound.get('origin', '?')} at {home[11:16]} local.",
            "",
            "  Subtract your departure estimate from that time to get the",
            "  hour everything must finish by.",
            "  - If that leaves nothing workable, the last day has NO",
            "    activities. It is a departure day.",
            "  - Otherwise every activity must END before that hour.",
        ]

    lines += [
        "",
        "Every start_time you write is local time at the destination.",
        "Build the days around these flights. Do not plan first and fit the",
        "flights in afterwards.",
        "============================================================",
    ]

    return "\n".join(lines)


def build_ai_prompt(
    params: dict,
    inventory: dict,
) -> str:

    return f"""
{_travel_window_block(params, inventory)}

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

  "arrival_transfer": {{
    "from_airport": "<arrival airport>",
    "to_city": "<destination city>",
    "estimated_minutes": 0,
    "method": "<train | taxi | shuttle | bus>",
    "note": "<one line the traveller would find useful>"
  }},

  "departure_transfer": {{
    "from_city": "<destination city>",
    "to_airport": "<departure airport>",
    "estimated_minutes": 0,
    "method": "<train | taxi | shuttle | bus>",
    "note": "<include check-in and security>"
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
    *,
    deadline: float | None = None,
):
    """
    Call the project's shared LLM provider.

    `deadline` is an absolute `time.monotonic()` deadline.  The shared
    provider already understands this argument and limits the underlying
    Gemini/Claude request to the remaining budget.
    """

    return _llm_call(
        system_prompt,
        user_prompt,
        max_tokens=LLM_MAX_TOKENS,
        deadline=deadline,
    ).text


# ============================================================================
# JSON PARSING
# ============================================================================

def _extract_json_object(raw: str) -> str:
    """Strip fences/surrounding prose and keep the outer JSON object."""

    cleaned = (raw or "").strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(
            r"^```(?:json)?\s*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\s*```$", "", cleaned)

    start = cleaned.find("{")
    end = cleaned.rfind("}")

    if start >= 0 and end > start:
        cleaned = cleaned[start:end + 1]

    return cleaned


def _looks_like_json_key(line: str) -> bool:
    """True when a stripped line begins with a JSON object key."""

    return bool(
        re.match(
            r'^"(?:[^"\\]|\\.)*"\s*:',
            line.lstrip(),
        )
    )


def _repair_common_json_issues(raw: str) -> str:
    """
    Repair a small set of common LLM JSON formatting mistakes.

    This intentionally stays conservative.  It does not invent values or
    restructure the response; it only:
      * removes trailing commas before `}` / `]`;
      * inserts a missing comma between pretty-printed fields; and
      * inserts a missing comma between adjacent array objects/arrays.

    All factual itinerary data is still checked against inventory later.
    """

    repaired = re.sub(r",\s*([}\]])", r"\1", raw)
    lines = repaired.splitlines()

    for index in range(len(lines) - 1):
        current = lines[index].rstrip()
        current_value = current.strip()

        if not current_value:
            continue

        next_index = index + 1
        while next_index < len(lines) and not lines[next_index].strip():
            next_index += 1

        if next_index >= len(lines):
            break

        next_value = lines[next_index].lstrip()

        if current_value.endswith((",", "{", "[", ":")):
            continue

        next_starts_new_value = (
            _looks_like_json_key(next_value)
            or next_value.startswith("{")
            or next_value.startswith("[")
        )

        current_can_end_value = (
            current_value.endswith(('"', "}", "]"))
            or bool(
                re.search(
                    r"(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$",
                    current_value,
                )
            )
        )

        if next_starts_new_value and current_can_end_value:
            lines[index] = current + ","

    return "\n".join(lines)


def parse_llm_response(raw: str) -> dict:
    """Parse model JSON, with one conservative repair pass before retrying."""

    if not raw:
        raise json.JSONDecodeError(
            "Empty LLM response",
            "",
            0,
        )

    cleaned = _extract_json_object(raw)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as first_error:
        repaired = _repair_common_json_issues(cleaned)

        if repaired == cleaned:
            raise first_error

        try:
            # strict=False also tolerates accidental literal control
            # characters inside strings while preserving JSON structure.
            return json.loads(repaired, strict=False)
        except json.JSONDecodeError:
            raise first_error


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
            # Local clock times and the transfer allowance, computed in
            # query_inventory. Without them here the model's flight dict keeps
            # only UTC and both the response and the frontend lose the
            # traveller's own times.
            "departure_local",
            "arrival_local",
            "transfer_hours_to_destination",
            "is_direct_to_destination",
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
# TRAVEL WINDOW ENFORCEMENT
# ============================================================================
#
# The prompt states the window; the model does not reliably respect it. This
# corrects the result afterwards, so the outcome does not depend on the model
# co-operating.


def _estimated_transfer_hours(
    transfer,
    fallback: float,
    label: str,
    notes: list,
) -> float:
    """
    The model's transfer estimate in hours, or the fallback.

    The estimate drives a hard scheduling decision, so it is bounds-checked:
    four minutes or eleven hours is a mistake, not a measurement. Anything
    outside MIN/MAX_TRANSFER_MINUTES is discarded and recorded, rather than
    silently trusted.
    """

    if not isinstance(transfer, dict):
        return fallback

    try:
        minutes = float(transfer.get("estimated_minutes"))
    except (TypeError, ValueError):
        return fallback

    if MIN_TRANSFER_MINUTES <= minutes <= MAX_TRANSFER_MINUTES:
        return minutes / 60.0

    notes.append(
        f"Ignored the AI estimate for {label} "
        f"({minutes:.0f} min, outside {MIN_TRANSFER_MINUTES}-"
        f"{MAX_TRANSFER_MINUTES}); used {fallback:.1f}h instead."
    )

    return fallback

def _enforce_travel_window(itinerary: dict, params: dict) -> dict:
    """
    Re-date day 1 from the local arrival, then move or drop any activity
    outside the time the traveller is actually on the ground.

    Runs after validate_itinerary, so flight fields hold inventory values.
    """

    days = itinerary.get("days") or []

    if not days:
        return itinerary

    flights = itinerary.get("flights") or []
    city = (params.get("destinations") or [""])[0]

    outbound = next(
        (f for f in flights if str(f.get("leg", "")).lower() == "outbound"),
        None,
    )
    inbound = next(
        (f for f in flights if str(f.get("leg", "")).lower() == "return"),
        None,
    )

    notes = []

    # --- day 1 is the local arrival date --------------------------------

    arrival_local = (
        _local_time(outbound.get("arrival_datetime"), outbound.get("destination"))
        if outbound
        else ""
    )

    if arrival_local:

        arrival_date = pd.to_datetime(arrival_local, errors="coerce")

        if pd.notna(arrival_date):

            stated = str(days[0].get("date") or "")[:10]
            target = arrival_date.strftime("%Y-%m-%d")

            if stated != target:
                notes.append(
                    f"Day 1 re-dated to {target}, the local arrival date "
                    f"(was {stated or 'unset'})."
                )

            for offset, day in enumerate(days):
                day["date"] = (
                    arrival_date + timedelta(days=offset)
                ).strftime("%Y-%m-%d")

    # --- nothing on day 1 before landing + transfer ----------------------

    if arrival_local and outbound:

        transfer = _estimated_transfer_hours(
            itinerary.get("arrival_transfer"),
            fallback=_transfer_hours(outbound.get("destination"), city),
            label=f"arrival transfer to {city}",
            notes=notes,
        )

        free_at = _clock_to_hours(arrival_local[11:16]) + transfer

        if free_at >= 0:

            kept = []

            for activity in days[0].get("activities") or []:

                start = _clock_to_hours(activity.get("start_time"))

                if start < 0 or start >= free_at:
                    kept.append(activity)
                    continue

                if free_at <= LATEST_USEFUL_START:
                    activity["start_time"] = _hours_to_clock(free_at)
                    kept.append(activity)
                    notes.append(
                        f"Moved '{activity.get('activity_name')}' to "
                        f"{activity['start_time']} on day 1: lands "
                        f"{arrival_local[11:16]} plus {transfer:.0f}h transfer."
                    )
                else:
                    notes.append(
                        f"Removed '{activity.get('activity_name')}' from day 1: "
                        f"not free until {_hours_to_clock(free_at)}."
                    )

            days[0]["activities"] = kept

            if transfer > DIRECT_TRANSFER_HOURS:
                days[0]["description"] = (
                    f"{days[0].get('description', '').rstrip()} "
                    f"Arrives {outbound.get('destination')}, then roughly "
                    f"{transfer:.0f} hours overland to {city}. This transfer "
                    "is not included in the package."
                ).strip()

    # --- nothing on the last day past the airport run --------------------

    departure_local = (
        _local_time(inbound.get("departure_datetime"), inbound.get("origin"))
        if inbound
        else ""
    )

    # Find the day the return flight actually leaves on, rather than assuming
    # it is the last one. An exact match on days[-1] silently skipped the
    # check whenever the model's dates disagreed with the flight, which let a
    # 10:00 activity sit above an 08:45 departure.
    _departure_index = None

    if departure_local:

        _departure_index = next(
            (
                index
                for index, day in enumerate(days)
                if str(day.get("date") or "")[:10] == departure_local[:10]
            ),
            None,
        )

        if _departure_index is None:
            _departure_index = len(days) - 1

            notes.append(
                "No day matches the return flight date "
                f"({departure_local[:10]}); applied the departure-day limit "
                "to the final day."
            )

        # Anything after the traveller has flown home is not a tight fit,
        # it is impossible.
        for day in days[_departure_index + 1:]:

            for activity in day.get("activities") or []:
                notes.append(
                    f"Removed '{activity.get('activity_name')}' from "
                    f"{day.get('date')}: after the return flight."
                )

            day["activities"] = []

    if departure_local and _departure_index is not None:

        _fallback_out = DEPARTURE_TRANSFER_HOURS

        if normalize_city(inbound.get("origin")) != normalize_city(city):
            _fallback_out = max(
                DEPARTURE_TRANSFER_HOURS,
                _transfer_hours(inbound.get("origin"), city),
            )

        transfer_out = _estimated_transfer_hours(
            itinerary.get("departure_transfer"),
            fallback=_fallback_out,
            label="departure transfer to the airport",
            notes=notes,
        )

        leave_by = _clock_to_hours(departure_local[11:16]) - transfer_out

        if leave_by >= 0:

            kept = []

            _departure_day = days[_departure_index]

            for activity in _departure_day.get("activities") or []:

                start = _clock_to_hours(activity.get("start_time"))

                try:
                    duration = float(activity.get("duration_hours") or 2)
                except (TypeError, ValueError):
                    duration = 2.0

                if start < 0 or start + duration <= leave_by:
                    kept.append(activity)
                else:
                    notes.append(
                        f"Removed '{activity.get('activity_name')}' from "
                        f"{_departure_day.get('date')}: must leave for the "
                        f"airport by {_hours_to_clock(leave_by)}."
                    )

            _departure_day["activities"] = kept

    if notes:

        validation = itinerary.setdefault("validation", {})
        validation["warnings"] = list(
            dict.fromkeys((validation.get("warnings") or []) + notes)
        )

        for note in notes:
            print(f"      [schedule] {note}")

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

        # Every other code (400 above all) is only actionable with Gemini's
        # own explanation, so keep it instead of reporting a bare status.
        return f"Gemini HTTP error {code}: {text[:300]}"

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
    # Only assigned on a successful parse, but the [timing] print below runs
    # unconditionally. Left unbound, every-attempt-failed raised
    # UnboundLocalError, which masked the real LLM error and skipped the
    # deterministic fallback further down.
    t_parse = 0.0

    # Absolute end-to-end deadline.  This starts at generate_itinerary(), so
    # Supabase time is included and the function can fall back before the
    # Next.js proxy reaches its ~120 second timeout.
    request_deadline = t_all_start + LLM_REQUEST_BUDGET_SECONDS

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

            remaining = request_deadline - time.perf_counter()
            if remaining <= 1.0:
                failure_reason = (
                    "Itinerary generation time budget exhausted before "
                    "another LLM attempt could start."
                )
                print(f"      [llm] {failure_reason}")
                break

            attempt_llm_start = time.perf_counter()
            raw = call_llm(
                SYSTEM_PROMPT,
                user_prompt
                + parse_guidance,
                deadline=request_deadline,
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

            # Retry temporary failures only when enough end-to-end time
            # remains.  A retry that starts too late merely guarantees the
            # browser sees a 504 before this function can return its fallback.
            if attempt < MAX_LLM_ATTEMPTS:

                is_rate_limit = (
                    "429" in failure_reason
                    or "rate limit" in failure_reason.lower()
                    or "quota" in failure_reason.lower()
                )

                delay = 20 * attempt if is_rate_limit else 2 * attempt
                remaining = request_deadline - time.perf_counter()

                if remaining <= delay + LLM_MIN_RETRY_SECONDS:
                    print(
                        "      [llm] skipping retry: "
                        f"only {max(0.0, remaining):.1f}s remain in request budget"
                    )
                    break

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

            # Always logged. Include a short window around the parser
            # position so malformed output can be diagnosed without dumping
            # the entire itinerary or prompt into logs.
            context_start = max(0, exc.pos - 100)
            context_end = min(len(raw), exc.pos + 140)
            error_context = raw[context_start:context_end].replace("\n", "\\n")

            print(
                f"      [llm] attempt {attempt}/{MAX_LLM_ATTEMPTS} "
                f"bad JSON ({len(raw)} chars): {exc}"
            )
            print(f"      [llm] parse context: {error_context}")

            if attempt < MAX_LLM_ATTEMPTS:

                remaining = request_deadline - time.perf_counter()
                if remaining <= LLM_MIN_RETRY_SECONDS:
                    print(
                        "      [llm] skipping JSON retry: "
                        f"only {max(0.0, remaining):.1f}s remain in request budget"
                    )
                    break

                parse_guidance = """
IMPORTANT - JSON RETRY:
Your previous response was invalid JSON. Recreate the response from scratch.

Return ONLY one complete JSON object.
Every object property and every array element MUST be separated by a comma.
Do not use markdown or code fences.
Do not truncate the response.
Do not add comments.
Do not add text before or after the JSON.
Keep prose concise so the complete object fits comfortably in the output.
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

    # Correct the schedule against real local flight times. After validation,
    # so flight fields hold inventory values rather than the model's.
    itinerary = _enforce_travel_window(itinerary, params)

    # Deterministic, not written by the model: the frontend needs a reliable
    # signal for "there is no flight here" so it can say so to the user.
    itinerary["flight_availability"] = inventory.get(
        "flight_availability",
        {
            "outbound_available": False,
            "return_available": False,
            "requested_city": "",
            "outbound_via": None,
            "return_via": None,
            "message": "",
        },
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