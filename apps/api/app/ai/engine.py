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
    # [^(]* rather than (.*?)\s* : the latter overlaps with \s* and
    # backtracks polynomially on long whitespace runs (CodeQL).
    # group(1) is .strip()ed below, so the trailing space is harmless.
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
# AIRPORT TIMEZONES
# ============================================================================
#
# Flight timestamps in Supabase are true UTC (verified against real elapsed
# durations). The model reasons in whatever it is shown, so a UTC arrival of
# 18:00 was being read as an evening arrival when it is in fact 03:00 the
# next morning in Tokyo - which is how day 1 ended up with a sunset cruise
# scheduled before the traveller had landed.
#
# Local times are computed here and passed alongside the UTC values so the
# model never has to do timezone arithmetic itself.

AIRPORT_TIMEZONES = {
    "SYD": "Australia/Sydney",
    "MEL": "Australia/Melbourne",
    "BNE": "Australia/Brisbane",
    "PER": "Australia/Perth",
    "CNS": "Australia/Brisbane",
    "AKL": "Pacific/Auckland",
    "ZQN": "Pacific/Auckland",
    "NRT": "Asia/Tokyo",
    "HND": "Asia/Tokyo",
    "KIX": "Asia/Tokyo",
    "ITM": "Asia/Tokyo",
    "CTS": "Asia/Tokyo",
    "ICN": "Asia/Seoul",
    "GMP": "Asia/Seoul",
    "PUS": "Asia/Seoul",
    "TPE": "Asia/Taipei",
    "HKG": "Asia/Hong_Kong",
    "PVG": "Asia/Shanghai",
    "SIN": "Asia/Singapore",
    "BKK": "Asia/Bangkok",
    "DMK": "Asia/Bangkok",
    "CNX": "Asia/Bangkok",
    "HKT": "Asia/Bangkok",
    "KUL": "Asia/Kuala_Lumpur",
    "DPS": "Asia/Makassar",
    "CGK": "Asia/Jakarta",
    "MNL": "Asia/Manila",
    "HAN": "Asia/Ho_Chi_Minh",
    "SGN": "Asia/Ho_Chi_Minh",
    "DAD": "Asia/Ho_Chi_Minh",
    "DEL": "Asia/Kolkata",
    "BOM": "Asia/Kolkata",
    "CMB": "Asia/Colombo",
    "DXB": "Asia/Dubai",
    "DOH": "Asia/Qatar",
    "CAI": "Africa/Cairo",
    "RAK": "Africa/Casablanca",
    "CPT": "Africa/Johannesburg",
    "NBO": "Africa/Nairobi",
    "LHR": "Europe/London",
    "LGW": "Europe/London",
    "STN": "Europe/London",
    "LTN": "Europe/London",
    "EDI": "Europe/London",
    "CDG": "Europe/Paris",
    "ORY": "Europe/Paris",
    "NCE": "Europe/Paris",
    "AMS": "Europe/Amsterdam",
    "BER": "Europe/Berlin",
    "VIE": "Europe/Vienna",
    "PRG": "Europe/Prague",
    "KRK": "Europe/Warsaw",
    "ZRH": "Europe/Zurich",
    "FCO": "Europe/Rome",
    "CIA": "Europe/Rome",
    "FLR": "Europe/Rome",
    "VCE": "Europe/Rome",
    "BCN": "Europe/Madrid",
    "MAD": "Europe/Madrid",
    "VLC": "Europe/Madrid",
    "LIS": "Europe/Lisbon",
    "OPO": "Europe/Lisbon",
    "ATH": "Europe/Athens",
    "JTR": "Europe/Athens",
    "IST": "Europe/Istanbul",
    "SAW": "Europe/Istanbul",
    "KEF": "Atlantic/Reykjavik",
    "JFK": "America/New_York",
    "EWR": "America/New_York",
    "LGA": "America/New_York",
    "YYZ": "America/Toronto",
    "LAX": "America/Los_Angeles",
    "SFO": "America/Los_Angeles",
    "YVR": "America/Vancouver",
    "HNL": "Pacific/Honolulu",
    "CUN": "America/Cancun",
    "MEX": "America/Mexico_City",
    "EZE": "America/Argentina/Buenos_Aires",
    "GIG": "America/Sao_Paulo",
    "CUZ": "America/Lima",
    "MDE": "America/Bogota",
}


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

    # Fall back to the canonical city's first listed code.
    city = normalize_city(text)
    codes = AIRPORT_CODES.get(city)

    return codes[0] if codes else ""


def _local_time(utc_value, iata: str) -> str:
    """
    Render a UTC timestamp in the airport's local time.

    Returns "" when the zone is unknown rather than guessing, so a missing
    airport shows nothing instead of a wrong time.
    """

    zone_name = AIRPORT_TIMEZONES.get(_iata_of(iata))

    if not zone_name or utc_value in (None, ""):
        return ""

    try:
        from zoneinfo import ZoneInfo

        stamp = pd.to_datetime(utc_value, utc=True, errors="coerce")

        if pd.isna(stamp):
            return ""

        return (
            stamp.tz_convert(ZoneInfo(zone_name))
            .strftime("%Y-%m-%d %H:%M")
        )

    except Exception:                                   # noqa: BLE001
        return ""


def _add_local_times(records: list) -> list:
    """Annotate flight records with local departure and arrival times."""

    for record in records:

        record["departure_local"] = _local_time(
            record.get("departure_datetime"),
            record.get("origin"),
        )

        record["arrival_local"] = _local_time(
            record.get("arrival_datetime"),
            record.get("destination"),
        )

    return records

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
        # Bounded for the same reason as the duration pattern above.
        r"budget\s*[:=\-]?\s*\$\s*([\d,]{1,15})",
        r"budget\s*[:=\-]?\s*([\d,]{1,15})\s*(?:aud|dollars?)",
        r"\$\s*([\d,]{1,15})",
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
    preferred_local_departure_date=None,
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
    # Without this the cheapest five flights on a route are returned
    # regardless of date, so the model receives an outbound in June and
    # a return in February and cannot build a coherent trip. It then
    # drops the return leg or puts both on one day.
    #
    # Falls back to the unfiltered set rather than returning nothing, so
    # a thin route still produces a draft.
    # ------------------------------------------------------------

    if (
        (not_before is not None or not_after is not None)
        and "departure_datetime" in candidates.columns
    ):

        def _utc(value):
            # Callers may pass a naive or an already-aware timestamp.
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

        window = pd.Series(
            True,
            index=candidates.index,
        )

        if not_before is not None:
            window &= departures >= _utc(not_before)

        if not_after is not None:
            window &= departures <= _utc(not_after)

        if window.any():
            candidates = candidates[window]

    # Prefer the requested local return date. If that exact date is not in
    # inventory, keep only the nearest available local departure date before
    # applying cabin/price ranking. This prevents a cheap early return from
    # shortening a long requested trip.
    if (
        preferred_local_departure_date
        and "departure_datetime" in candidates.columns
        and "origin" in candidates.columns
    ):

        target_day = pd.to_datetime(
            preferred_local_departure_date,
            errors="coerce",
        )

        if pd.notna(target_day):

            def _local_departure_distance(row):
                local_value = _local_time(
                    row.get("departure_datetime"),
                    row.get("origin"),
                )

                if not local_value:
                    return float("inf")

                local_day = pd.to_datetime(
                    local_value[:10],
                    errors="coerce",
                )

                if pd.isna(local_day):
                    return float("inf")

                return abs((local_day - target_day).days)

            candidates["return_date_distance"] = candidates.apply(
                _local_departure_distance,
                axis=1,
            )

            finite = candidates[
                candidates["return_date_distance"] != float("inf")
            ]

            if not finite.empty:
                nearest = finite["return_date_distance"].min()
                candidates = candidates[
                    candidates["return_date_distance"].eq(nearest)
                ]

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

    # Anchor the return to the requested trip length. Day 1 is the local
    # arrival date, so a N-day trip should fly home on local day N rather
    # than choosing the cheapest return anywhere between day 2 and N+2.
    _return_from = None
    _return_to = None
    _return_target_local_date = None

    if not outbound.empty:

        _outbound_anchor = outbound.iloc[0]
        _arrival_local = _local_time(
            _outbound_anchor.get("arrival_datetime"),
            _outbound_anchor.get("destination"),
        )

        if _arrival_local:
            _arrival_day = pd.to_datetime(
                _arrival_local[:10],
                errors="coerce",
            )

            if pd.notna(_arrival_day):
                _return_target_local_date = (
                    _arrival_day
                    + pd.Timedelta(days=max(1, duration_days) - 1)
                ).strftime("%Y-%m-%d")

        _arrival_utc = pd.to_datetime(
            _outbound_anchor.get("arrival_datetime"),
            errors="coerce",
            utc=True,
        )

        if pd.notna(_arrival_utc):
            _target_utc = _arrival_utc + pd.Timedelta(
                days=max(1, duration_days) - 1
            )
            _return_from = _target_utc - pd.Timedelta(days=1)
            _return_to = _target_utc + pd.Timedelta(days=1)

    inbound = _select_best_flights(
        flights_df,
        destinations[-1],
        origin,
        cabin_preference,
        group_size,
        not_before=_return_from,
        not_after=_return_to,
        preferred_local_departure_date=_return_target_local_date,
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

    # Local times alongside the UTC values, so the model can read the day and
    # hour the traveller actually experiences without converting anything.
    for leg in inter_city_legs:
        _add_local_times(leg["options"])

    return {
        "outbound_flight_options": _add_local_times(
            outbound.to_dict(
                orient="records"
            )
        ),
        "inbound_flight_options": _add_local_times(
            inbound.to_dict(
                orient="records"
            )
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



def _travel_window_block(inventory: dict) -> str:
    """
    A plain-language statement of the travel window, in local time, placed at
    the very top of the prompt.

    The flight times are otherwise buried inside JSON arrays further down, and
    the model was reading the UTC fields and dating day 1 from the departure.
    Stating the window first, in the traveller's own clock, gives it the
    constraint before it starts planning rather than after.
    """

    outbound = (inventory.get("outbound_flight_options") or [None])[0]
    inbound = (inventory.get("inbound_flight_options") or [None])[0]

    if not outbound:
        return (
            "TRAVEL WINDOW:\n"
            "No outbound flight is available. Plan activities only; do not "
            "invent flights."
        )

    arrive = outbound.get("arrival_local") or ""
    depart = outbound.get("departure_local") or ""

    lines = [
        "============================================================",
        "TRAVEL WINDOW - READ THIS BEFORE PLANNING ANYTHING",
        "============================================================",
        "",
        "All times below are LOCAL clock times at the airport concerned.",
        "Plan the whole itinerary inside this window.",
        "",
        f"  Leave {outbound.get('origin', '?')}    {depart or 'unknown'}",
        f"  Land  {outbound.get('destination', '?')}    {arrive or 'unknown'}",
    ]

    if inbound:
        lines.append(
            f"  Fly home from {inbound.get('origin', '?')}    "
            f"{inbound.get('departure_local') or 'unknown'}"
        )

    if arrive[:10]:

        lines += [
            "",
            f"DAY 1 IS {arrive[:10]}. That is the date you land, not the date "
            "you take off.",
            "",
            f"On day 1 the traveller is not free until roughly "
            f"{arrive[11:16]} plus three hours for immigration, baggage and "
            "the transfer into the city. Schedule nothing before that. If "
            "that leaves no usable time, day 1 has no activities at all - an "
            "empty first day is correct and expected after a long flight.",
        ]

    if inbound and (inbound.get("departure_local") or "")[:10]:

        home = inbound["departure_local"]

        lines += [
            "",
            f"THE LAST DAY IS {home[:10]}. The flight home leaves at "
            f"{home[11:16]} local, so everything must finish at least three "
            "hours before that. If the flight is in the morning, the last "
            "day has no activities.",
        ]

    lines += [
        "",
        "Every start_time you write is local time at the destination.",
        "Build the days around these flights. Do not plan first and fit the "
        "flights in afterwards.",
        "============================================================",
    ]

    return "\n".join(lines)

def build_ai_prompt(
    params: dict,
    inventory: dict,
) -> str:

    return f"""
{_travel_window_block(inventory)}

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

FLIGHT DATES AND DAY 1:
The outbound and return flights below are already filtered to a consistent
travel window.

Every flight record carries two pairs of times:

  departure_datetime / arrival_datetime  - UTC, ignore these for planning
  departure_local    / arrival_local     - the local clock at each airport

USE THE _local FIELDS AND NOTHING ELSE. They are the day and hour the
traveller actually experiences. Do not convert timezones yourself.

Day 1 is the date in the outbound flight's arrival_local. A flight showing
departure_local "2026-06-01 20:00" and arrival_local "2026-06-02 03:00" makes
2026-06-02 day 1 - not 2026-06-01.

No activity on day 1 may start before the arrival_local time. Landing at
03:00 means nothing before 03:00, and realistically nothing before late
morning. If the flight lands late in the evening, day 1 should have no
activities at all.

On the final day, no activity may end after the return flight's
departure_local time.

Set depart_date to the outbound departure_local date, and return_date to the
return departure_local date. The return must depart on a later day than the
outbound.

All start_time values you write are local time at the destination, matching
the _local fields.

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



# ── Align the model's days to the flights actually selected ─────────────────

# Landing to first activity, and last activity to wheels-up.
ARRIVAL_BUFFER_HOURS = 2.0
DEPARTURE_BUFFER_HOURS = 3.0

# Past this hour an activity shifted into the evening is no longer plausible.
LATEST_SHIFTED_START_HOUR = 20


def _clock_to_hours(value) -> float | None:
    """'14:30' -> 14.5. None when unparseable."""

    match = re.match(r"^\s*(\d{1,2}):(\d{2})", str(value or ""))

    if not match:
        return None

    return int(match.group(1)) + int(match.group(2)) / 60.0


def _hours_to_clock(hours: float) -> str:
    """14.5 -> '14:30', clamped to the same day."""

    hours = max(0.0, min(23.75, hours))
    whole = int(hours)
    minutes = int(round((hours - whole) * 60 / 15) * 15)

    if minutes == 60:
        whole, minutes = min(23, whole + 1), 0

    return f"{whole:02d}:{minutes:02d}"


def _align_days_to_flights(itinerary: dict, warnings: list) -> dict:
    """
    Rewrite day dates and activity times from the flights that were actually
    chosen.

    The model was asked repeatedly, in the prompt, to date day 1 from the
    local arrival and to keep activities inside the travel window. It does not
    reliably do either - it returns Tokyo activities dated to the Sydney
    departure day, and activities scheduled before the plane lands. Timezone
    arithmetic across the itinerary is deterministic, so the engine does it
    here rather than asking.

    Day 1 becomes the local arrival date. On day 1 nothing may start before
    landing plus a transfer buffer; on the departure day nothing may run past
    check-in time. Activities that cannot be shifted into a plausible slot are
    dropped, and each change is reported in warnings.
    """

    days = itinerary.get("days") or []

    if not days:
        return itinerary

    flights = itinerary.get("flights") or []

    outbound = next(
        (f for f in flights if str(f.get("leg", "")).lower() == "outbound"),
        None,
    )

    inbound = next(
        (f for f in flights if str(f.get("leg", "")).lower() == "return"),
        None,
    )

    # ------------------------------------------------------------
    # Day 1 is the local arrival date; every later day follows it.
    # ------------------------------------------------------------

    arrival_local = None

    if outbound:
        arrival_local = _local_time(
            outbound.get("arrival_datetime"),
            outbound.get("destination"),
        )

    if arrival_local:

        try:
            day_one = datetime.strptime(
                arrival_local,
                "%Y-%m-%d %H:%M",
            )
        except ValueError:
            day_one = None

        if day_one is not None:

            old_first = days[0].get("date")

            for index, day in enumerate(days):
                day["day_number"] = index + 1
                day["date"] = str(
                    (day_one + timedelta(days=index)).date()
                )

            if old_first and old_first != days[0]["date"]:
                warnings.append(
                    f"Day 1 re-dated from {old_first} to "
                    f"{days[0]['date']} to match the local arrival."
                )

            # --------------------------------------------------------
            # Nothing on day 1 before the plane lands.
            # --------------------------------------------------------

            earliest = (
                day_one.hour
                + day_one.minute / 60.0
                + ARRIVAL_BUFFER_HOURS
            )

            kept = []

            for activity in days[0].get("activities") or []:

                start = _clock_to_hours(activity.get("start_time"))

                if start is None or start >= earliest:
                    kept.append(activity)
                    continue

                if earliest <= LATEST_SHIFTED_START_HOUR:
                    activity["start_time"] = _hours_to_clock(earliest)
                    kept.append(activity)

                    warnings.append(
                        f"\"{activity.get('activity_name', 'Activity')}\" moved "
                        f"to {activity['start_time']} on day 1: the flight "
                        f"lands at {day_one.strftime('%H:%M')} local."
                    )

                else:
                    warnings.append(
                        f"\"{activity.get('activity_name', 'Activity')}\" removed "
                        f"from day 1: the flight lands at "
                        f"{day_one.strftime('%H:%M')} local, too late to fit it."
                    )

            days[0]["activities"] = kept

    # ------------------------------------------------------------
    # Nothing on the departure day that runs past check-in.
    # ------------------------------------------------------------

    departure_local = None

    if inbound:
        departure_local = _local_time(
            inbound.get("departure_datetime"),
            inbound.get("origin"),
        )

    if departure_local:

        try:
            leave_at = datetime.strptime(
                departure_local,
                "%Y-%m-%d %H:%M",
            )
        except ValueError:
            leave_at = None

        if leave_at is not None:

            latest_end = (
                leave_at.hour
                + leave_at.minute / 60.0
                - DEPARTURE_BUFFER_HOURS
            )

            last_day = days[-1]
            kept = []

            for activity in last_day.get("activities") or []:

                start = _clock_to_hours(activity.get("start_time"))

                duration = pd.to_numeric(
                    activity.get("duration_hours", 1),
                    errors="coerce",
                )

                duration = 1.0 if pd.isna(duration) else float(duration)

                if start is None or start + duration <= latest_end:
                    kept.append(activity)
                    continue

                warnings.append(
                    f"\"{activity.get('activity_name', 'Activity')}\" removed "
                    f"from the final day: the return flight leaves at "
                    f"{leave_at.strftime('%H:%M')} local."
                )

            last_day["activities"] = kept

    itinerary["days"] = days

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
            "departure_local",
            "arrival_local",
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
    # Return must depart after the outbound arrives
    #
    # The model picks from the options it is given; a same-day or
    # reversed pair is a planning error the engine can detect
    # deterministically, so it is reported rather than left to the
    # reader to spot.
    # ------------------------------------------------------------

    _outbound_leg = next(
        (
            f for f in valid_flights
            if str(f.get("leg", "")).lower() == "outbound"
        ),
        None,
    )

    _return_leg = next(
        (
            f for f in valid_flights
            if str(f.get("leg", "")).lower() == "return"
        ),
        None,
    )

    if _outbound_leg and _return_leg:

        _out_arrival = pd.to_datetime(
            _outbound_leg.get("arrival_datetime"),
            errors="coerce",
            utc=True,
        )

        _ret_departure = pd.to_datetime(
            _return_leg.get("departure_datetime"),
            errors="coerce",
            utc=True,
        )

        if pd.notna(_out_arrival) and pd.notna(_ret_departure):

            if _ret_departure < _out_arrival:

                errors.append(
                    "Return flight departs before the outbound flight "
                    "arrives."
                )

            elif _ret_departure.date() == _out_arrival.date():

                warnings.append(
                    "Outbound and return flights are on the same day."
                )

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
# DETERMINISTIC ACTIVITY SCHEDULER
# ============================================================================
#
# DESIGN:
#
# Gemini decides:
#   - which activities
#   - which day they belong to
#   - titles / descriptions / notes
#
# Python decides:
#   - the real day dates
#   - when activities can start
#   - whether an activity fits before the next activity / flight
#
# Flight times are the source of truth.
#
# OUTBOUND:
#   use arrival_local at destination
#
# RETURN:
#   use departure_local at destination
#
# The activity start_time produced by Gemini is NOT trusted.
# It is rebuilt below.


# Traveller needs time after landing for baggage / immigration / transport.
ACTIVITY_ARRIVAL_BUFFER_HOURS = 2.0

# Traveller must stop sightseeing before the return flight.
ACTIVITY_DEPARTURE_BUFFER_HOURS = 3.0

# Normal sightseeing window on a full day.
ACTIVITY_DAY_START_HOUR = 9.0
ACTIVITY_DAY_END_HOUR = 20.0

# Gap between two activities.
ACTIVITY_GAP_HOURS = 0.5


def _schedule_hours_to_clock(value: float) -> str:
    """Convert decimal hour to HH:MM, rounded to 15-minute increments."""

    value = max(0.0, min(23.75, float(value)))
    hour = int(value)
    minute = int(round((value - hour) * 60 / 15) * 15)

    if minute >= 60:
        hour += 1
        minute = 0

    hour = min(hour, 23)
    return f"{hour:02d}:{minute:02d}"


def _schedule_parse_local_datetime(
    flight: dict | None,
    local_field: str,
    utc_field: str,
    airport_field: str,
):
    """
    Return a local datetime for a flight.

    Prefer the local value already added by _add_local_times(). If it is
    missing, calculate it from the UTC timestamp and airport timezone.
    """

    if not flight:
        return None

    local_value = flight.get(local_field)

    if not local_value:
        local_value = _local_time(
            flight.get(utc_field),
            flight.get(airport_field),
        )

    if not local_value:
        return None

    parsed = pd.to_datetime(local_value, errors="coerce")

    if pd.isna(parsed):
        return None

    return parsed


def _schedule_activity_duration(activity: dict) -> float:
    """Get activity duration from inventory-enriched data."""

    try:
        duration = float(activity.get("duration_hours") or 2.0)
    except (TypeError, ValueError):
        duration = 2.0

    # Defensive limits so bad data cannot break the day planner.
    return max(0.5, min(duration, 8.0))


def _schedule_get_flights(itinerary: dict):
    """Return the selected outbound and return flights."""

    flights = itinerary.get("flights") or []

    outbound = next(
        (
            flight
            for flight in flights
            if str(flight.get("leg", "")).lower() == "outbound"
        ),
        None,
    )

    return_flight = next(
        (
            flight
            for flight in flights
            if str(flight.get("leg", "")).lower() == "return"
        ),
        None,
    )

    return outbound, return_flight


def _schedule_day_window(day_date, arrival_dt, departure_dt):
    """
    Calculate the usable activity window for one local calendar day.

    Normal day:
        09:00 -> 20:00

    Arrival day:
        max(09:00, arrival + arrival buffer)

    Departure day:
        min(20:00, departure - airport/check-in buffer)
    """

    window_start = ACTIVITY_DAY_START_HOUR
    window_end = ACTIVITY_DAY_END_HOUR

    if arrival_dt is not None and day_date == arrival_dt.date():
        arrival_hour = arrival_dt.hour + arrival_dt.minute / 60.0
        window_start = max(
            window_start,
            arrival_hour + ACTIVITY_ARRIVAL_BUFFER_HOURS,
        )

    if departure_dt is not None and day_date == departure_dt.date():
        departure_hour = departure_dt.hour + departure_dt.minute / 60.0
        window_end = min(
            window_end,
            departure_hour - ACTIVITY_DEPARTURE_BUFFER_HOURS,
        )

    return window_start, window_end


def _schedule_activities_from_flights(itinerary: dict) -> dict:
    """
    Rebuild activity start times around the REAL local flight times.

    Gemini's activity start_time values are ignored.

    Rules:
    1. Day 1 starts on the local outbound arrival date.
    2. Arrival-day activities begin only after arrival + transfer buffer.
    3. Full sightseeing days normally run 09:00-20:00.
    4. Departure-day activities must finish before departure - airport buffer.
    5. No activities may exist after the return-flight date.
    6. Activities do not overlap.
    7. Activity durations come from inventory-enriched data.
    8. If an activity cannot fit, it is removed instead of receiving an
       impossible time.
    """

    days = itinerary.get("days") or []

    if not days:
        return itinerary

    outbound, return_flight = _schedule_get_flights(itinerary)

    arrival_dt = _schedule_parse_local_datetime(
        outbound,
        "arrival_local",
        "arrival_datetime",
        "destination",
    )

    departure_dt = _schedule_parse_local_datetime(
        return_flight,
        "departure_local",
        "departure_datetime",
        "origin",
    )

    notes = []

    # ------------------------------------------------------------------------
    # Rebuild all day dates from the real LOCAL arrival date.
    # ------------------------------------------------------------------------

    if arrival_dt is not None:
        arrival_date = arrival_dt.date()

        for index, day in enumerate(days):
            correct_date = arrival_date + timedelta(days=index)
            old_date = str(day.get("date", ""))[:10]

            day["day_number"] = index + 1
            day["date"] = correct_date.isoformat()

            if old_date and old_date != day["date"]:
                notes.append(
                    f"Day {index + 1} date changed from {old_date} to "
                    f"{day['date']} to match the real local arrival date."
                )

    # ------------------------------------------------------------------------
    # Keep trip metadata aligned with the selected flights.
    # ------------------------------------------------------------------------

    travel_dates = itinerary.setdefault("trip", {}).setdefault(
        "travel_dates",
        {},
    )

    outbound_departure = _schedule_parse_local_datetime(
        outbound,
        "departure_local",
        "departure_datetime",
        "origin",
    )

    if outbound_departure is not None:
        travel_dates["depart_date"] = outbound_departure.date().isoformat()

    if departure_dt is not None:
        travel_dates["return_date"] = departure_dt.date().isoformat()

    # If the chosen return flight does not line up with the generated trip
    # length, report it. This scheduler does not invent extra itinerary days.
    if departure_dt is not None:
        generated_dates = {
            str(day.get("date", ""))[:10]
            for day in days
        }
        return_date_string = departure_dt.date().isoformat()

        if return_date_string not in generated_dates:
            notes.append(
                "Return flight departs on "
                f"{return_date_string}, but the generated activity days do "
                "not contain that date. Activity timing is still constrained "
                "to the real local flight times; flight-duration alignment "
                "must be handled separately."
            )

    # ------------------------------------------------------------------------
    # Rebuild every activity start time from the usable day window.
    # ------------------------------------------------------------------------

    for day in days:
        day_date_text = str(day.get("date", ""))[:10]

        try:
            day_date = datetime.strptime(
                day_date_text,
                "%Y-%m-%d",
            ).date()
        except ValueError:
            notes.append(
                f"Could not schedule activities for day "
                f"{day.get('day_number')}: invalid date '{day_date_text}'."
            )
            continue

        activities = list(day.get("activities") or [])

        # Nothing can happen after the traveller has already left.
        if departure_dt is not None and day_date > departure_dt.date():
            if activities:
                notes.append(
                    f"Removed {len(activities)} activity/activities from "
                    f"{day_date_text}: the return flight already departed on "
                    f"{departure_dt.date().isoformat()}."
                )

            day["activities"] = []
            continue

        window_start, window_end = _schedule_day_window(
            day_date,
            arrival_dt,
            departure_dt,
        )

        # Example: arrival 21:15 + 2h buffer = 23:15, but sightseeing ends at
        # 20:00, so an empty arrival day is the only valid result.
        if window_start >= window_end:
            if activities:
                notes.append(
                    f"Removed all activities from {day_date_text}: usable "
                    f"activity window is empty "
                    f"({_schedule_hours_to_clock(window_start)} to "
                    f"{_schedule_hours_to_clock(window_end)})."
                )

            day["activities"] = []
            continue

        # Ignore every start_time from Gemini. Activities are placed one after
        # another using real inventory duration + a transfer gap.
        cursor = window_start
        scheduled = []

        for activity in activities:
            duration = _schedule_activity_duration(activity)
            activity_start = cursor
            activity_end = activity_start + duration

            if activity_end > window_end:
                notes.append(
                    f"Removed '{activity.get('activity_name', 'Activity')}' "
                    f"from {day_date_text}: it needs {duration:.1f}h but does "
                    f"not fit before {_schedule_hours_to_clock(window_end)}."
                )
                continue

            activity["start_time"] = _schedule_hours_to_clock(activity_start)
            scheduled.append(activity)

            cursor = activity_end + ACTIVITY_GAP_HOURS

        day["activities"] = scheduled

    # ------------------------------------------------------------------------
    # Diagnostics.
    # ------------------------------------------------------------------------

    if arrival_dt is not None:
        print(
            "[schedule] local arrival="
            f"{arrival_dt.strftime('%Y-%m-%d %H:%M')}"
        )

    if departure_dt is not None:
        print(
            "[schedule] local departure="
            f"{departure_dt.strftime('%Y-%m-%d %H:%M')}"
        )

    for day in days:
        activity_log = [
            (
                activity.get("start_time"),
                activity.get("activity_name"),
            )
            for activity in (day.get("activities") or [])
        ]

        print(
            f"[schedule] day {day.get('day_number')} "
            f"{day.get('date')} {activity_log}"
        )

    if notes:
        validation = itinerary.setdefault("validation", {})
        existing = validation.get("warnings") or []
        validation["warnings"] = list(dict.fromkeys(existing + notes))

        for note in notes:
            print(f"[schedule] {note}")

    itinerary["days"] = days
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
        r"Gemini HTTP (\d{1,3})",
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

    # Build the activity schedule from the real local flight times.
    # Gemini chooses the activities, but Python owns their start times.
    itinerary = _schedule_activities_from_flights(
        itinerary
    )

    # Scheduling can remove activities that no longer fit. Recalculate the
    # deterministic budget so removed activities are not still charged.
    itinerary["budget_breakdown"] = calculate_deterministic_budget(
        itinerary,
        params,
    )

    itinerary.setdefault("trip", {})["total_cost_aud"] = (
        itinerary["budget_breakdown"]["total_aud"]
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