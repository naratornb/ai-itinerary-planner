"""
copilot.py — Context-Aware Co-Pilot
===================================

Usage:
    from ai.copilot import create_session, copilot_turn

    session = create_session()
    result = copilot_turn(
        session,
        "Find me a food activity in Tokyo"
    )

Architecture:
    User
      ↓
    preprocess_input()
      ↓
    Entity / intent detection
      ↓
    Supabase inventory
      ↓
    BM25 retrieval
      ↓
    Prompt construction
      ↓
    llm_provider.call_llm()
      ↓
    JSON parsing / validation
      ↓
    Session update

IMPORTANT:
    This file must NOT import anthropic or google.genai directly.

    All LLM calls go through:
        llm_provider.call_llm()
"""

import json
import os
import re
import time
import uuid

import pandas as pd
import nltk

from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer

from rank_bm25 import BM25Okapi


# ============================================================================
# LLM PROVIDER
# ============================================================================

try:
    # Package import
    from .llm_provider import call_llm as _llm_call
    from .llm_provider import active_provider

except ImportError:
    # Direct script import
    from llm_provider import call_llm as _llm_call
    from llm_provider import active_provider


# ============================================================================
# NLTK
# ============================================================================

nltk.download("stopwords", quiet=True)
nltk.download("wordnet", quiet=True)
nltk.download("omw-1.4", quiet=True)


print("✅ All imports successful")


# ============================================================================
# SUPABASE
# ============================================================================

def _get_supabase():
    """
    Create a Supabase client using environment variables.
    """

    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise EnvironmentError(
            "SUPABASE_URL and SUPABASE_KEY must be set."
        )

    return create_client(url, key)


def _fetch_all(table: str, page: int = 1000) -> pd.DataFrame:
    """
    Fetch all rows from a Supabase table.

    Supabase/PostgREST commonly limits a normal query to 1000 rows,
    therefore we retrieve the table in pages.
    """

    sb = _get_supabase()

    rows = []
    start = 0

    while True:

        response = (
            sb.table(table)
            .select("*")
            .range(start, start + page - 1)
            .execute()
        )

        chunk = response.data or []

        rows.extend(chunk)

        if len(chunk) < page:
            break

        start += page

    return pd.DataFrame(rows)


# ============================================================================
# LOAD INVENTORY
# ============================================================================

activities_df = _fetch_all("activities")
hotels_df = _fetch_all("hotels")
flights_df = _fetch_all("flights")

_SOURCE = "supabase"


# ============================================================================
# NORMALISE INVENTORY
# ============================================================================

# Flights
if "duration_mins" in flights_df.columns:
    flights_df = flights_df.rename(
        columns={"duration_mins": "duration_minutes"}
    )


# Activities
ACTIVITY_DEFAULTS = {
    "vibe": "",
    "best_season": "",
    "address": "",
    "availability": "Year-round",
}

for column, default in ACTIVITY_DEFAULTS.items():

    if column not in activities_df.columns:
        activities_df[column] = default


# Flights
if "seats_available" not in flights_df.columns:
    flights_df["seats_available"] = 999


# Hotels
if "max_guests" not in hotels_df.columns:
    hotels_df["max_guests"] = 999


print(f"[inventory] source={_SOURCE}")

print(
    f"✅ Activities : {len(activities_df)} rows | "
    f"cols: {activities_df.columns.tolist()}"
)

print(
    f"✅ Hotels     : {len(hotels_df)} rows"
)

print(
    f"✅ Flights    : {len(flights_df)} rows"
)


# ============================================================================
# INTERNAL SCHEMA
# ============================================================================

if "hotel_name" in hotels_df.columns:
    hotels_df = hotels_df.rename(
        columns={"hotel_name": "activity_name"}
    )


if "flight_name" in flights_df.columns:
    flights_df = flights_df.rename(
        columns={"flight_name": "activity_name"}
    )


if "destination" in flights_df.columns:
    flights_df = flights_df.rename(
        columns={"destination": "city"}
    )


for df in [hotels_df, flights_df]:

    defaults = {
        "category": "general",
        "travel_style": "all",
        "rating": 4.0,
        "country": "",
    }

    for column, default in defaults.items():

        if column not in df.columns:
            df[column] = default


# ============================================================================
# NLP SETUP
# ============================================================================

lemmatizer = WordNetLemmatizer()

stop_words = set(
    stopwords.words("english")
)


# ============================================================================
# VOCABULARY
# ============================================================================

ALL_CITIES = set()
ALL_COUNTRIES = set()
ALL_NAMES = set()

COUNTRY_TO_CITIES = {}


# ---------------------------------------------------------------------------
# Activities
# ---------------------------------------------------------------------------

if "city" in activities_df.columns:

    ALL_CITIES |= set(
        activities_df["city"]
        .dropna()
        .astype(str)
        .str.lower()
    )


if "country" in activities_df.columns:

    ALL_COUNTRIES |= set(
        activities_df["country"]
        .dropna()
        .astype(str)
        .str.lower()
    )

    if "city" in activities_df.columns:

        temp = activities_df[
            ["city", "country"]
        ].drop_duplicates()

        for _, row in temp.iterrows():

            country = str(
                row["country"]
            ).lower()

            city = str(
                row["city"]
            ).lower()

            COUNTRY_TO_CITIES.setdefault(
                country,
                []
            )

            if city not in COUNTRY_TO_CITIES[country]:

                COUNTRY_TO_CITIES[country].append(
                    city
                )


# ---------------------------------------------------------------------------
# Hotels
# ---------------------------------------------------------------------------

if "city" in hotels_df.columns:

    ALL_CITIES |= set(
        hotels_df["city"]
        .dropna()
        .astype(str)
        .str.lower()
    )


# ---------------------------------------------------------------------------
# Flights
# ---------------------------------------------------------------------------

if "origin" in flights_df.columns:

    ALL_CITIES |= set(
        flights_df["origin"]
        .dropna()
        .astype(str)
        .str.lower()
    )


if "city" in flights_df.columns:

    ALL_CITIES |= set(
        flights_df["city"]
        .dropna()
        .astype(str)
        .str.lower()
    )


# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------

if "activity_name" in activities_df.columns:

    ALL_NAMES |= set(
        activities_df["activity_name"]
        .dropna()
        .astype(str)
        .str.lower()
    )


if "activity_name" in hotels_df.columns:

    ALL_NAMES |= set(
        hotels_df["activity_name"]
        .dropna()
        .astype(str)
        .str.lower()
    )


if "airline" in flights_df.columns:

    ALL_NAMES |= set(
        flights_df["airline"]
        .dropna()
        .astype(str)
        .str.lower()
    )


# ---------------------------------------------------------------------------
# Vibes
# ---------------------------------------------------------------------------

ALL_VIBES = set()

if "vibe" in activities_df.columns:

    for vibe_str in activities_df["vibe"].dropna():

        for vibe in str(vibe_str).split(";"):

            vibe = vibe.strip().lower()

            if vibe:
                ALL_VIBES.add(vibe)


# ============================================================================
# CONSTANTS
# ============================================================================

KNOWN_STYLES = [
    "solo",
    "couple",
    "group",
    "family",
]


KNOWN_CATS = [
    "food",
    "culture",
    "adventure",
    "nature",
    "beach",
    "history",
    "relaxation",
]


BUDGET_WORDS = {
    "cheap": "low",
    "budget": "low",
    "affordable": "low",
    "luxury": "high",
    "expensive": "high",
    "premium": "high",
}


INAPPROPRIATE_WORDS = {
    "kill",
    "hate",
    "bomb",
    "attack",
    "drug",
    "weapon",
    "naked",
    "sex",
    "porn",
    "illegal",
    "steal",
    "hack",
    "fake",
    "scam",
}


DETAIL_TRIGGERS = [
    "tell me more",
    "more details",
    "more info",
    "more information",
    "what else",
    "describe",
    "explain",
    "how does",
    "what is",
    "full details",
    "full description",
    "more about",
]


EXTERNAL_LINK_TRIGGERS = [
    "website",
    "link",
    "url",
    "book online",
    "official site",
    "booking.com",
    "tripadvisor",
    "google it",
]


print(
    f"✅ Vocab: "
    f"{len(ALL_CITIES)} cities, "
    f"{len(ALL_COUNTRIES)} countries, "
    f"{len(ALL_NAMES)} names, "
    f"{len(ALL_VIBES)} vibes"
)


# ============================================================================
# TEXT CLEANING
# ============================================================================

def clean_text(text: str) -> str:

    text = re.sub(
        r"http\S+|www\S+",
        "",
        text
    )

    text = re.sub(
        r"[^a-zA-Z\s]",
        " ",
        text
    ).lower()

    tokens = []

    for word in text.split():

        if word in stop_words:
            continue

        if len(word) <= 2:
            continue

        tokens.append(
            lemmatizer.lemmatize(word)
        )

    return " ".join(tokens)


# ============================================================================
# ERROR CLASSIFICATION
# ============================================================================

def classify_error(
    raw: str,
    clean: str
):

    lower = raw.lower().strip()

    if len(lower) < 2:
        return "HUMAN_INPUT_ERROR"

    if re.match(
        r"^[^a-zA-Z]+$",
        lower
    ):
        return "HUMAN_INPUT_ERROR"

    if any(
        word in lower.split()
        for word in INAPPROPRIATE_WORDS
    ):
        return "HUMAN_INPUT_ERROR"

    words = lower.split()

    real_words = [
        word
        for word in words
        if len(word) > 2
    ]

    if (
        len(words) >= 3
        and len(real_words) / len(words) < 0.4
    ):
        return "HUMAN_INPUT_ERROR"

    if any(
        trigger in lower
        for trigger in (
            DETAIL_TRIGGERS
            + EXTERNAL_LINK_TRIGGERS
        )
    ):
        return "DETAIL_REQUEST"

    return None


# ============================================================================
# ENTITY EXTRACTION
# ============================================================================

def extract_entities(raw: str) -> dict:

    lower = raw.lower()

    city = next(
        (
            city
            for city in ALL_CITIES
            if city in lower
        ),
        None
    )

    country = next(
        (
            country
            for country in ALL_COUNTRIES
            if country in lower
        ),
        None
    )

    country_cities = (
        COUNTRY_TO_CITIES.get(
            country,
            []
        )
        if country
        else []
    )

    name = next(
        (
            name
            for name in ALL_NAMES
            if name in lower
        ),
        None
    )

    style = next(
        (
            style
            for style in KNOWN_STYLES
            if style in lower
        ),
        None
    )

    category = next(
        (
            category
            for category in KNOWN_CATS
            if category in lower
        ),
        None
    )

    vibe = next(
        (
            vibe
            for vibe in ALL_VIBES
            if vibe in lower
        ),
        None
    )

    budget_level = None

    for word, level in BUDGET_WORDS.items():

        if word in lower:

            budget_level = level

            break


    price_match = re.search(
        r"\$?(\d+)",
        raw
    )

    max_price = (
        int(price_match.group(1))
        if price_match
        else None
    )


    return {
        "city": city,
        "country": country,
        "country_cities": country_cities,
        "name": name,
        "travel_style": style,
        "category": category,
        "vibe": vibe,
        "budget_level": budget_level,
        "max_price": max_price,
    }


# ============================================================================
# INTENT CLASSIFICATION
# ============================================================================

def classify_intent(
    clean: str,
    entities: dict
) -> str:

    if entities.get("name"):
        return "search_specific"

    if any(
        word in clean
        for word in [
            "recommend",
            "suggest",
            "find",
            "show",
            "look",
        ]
    ):
        return "recommend"

    if any(
        word in clean
        for word in [
            "book",
            "reserv",
            "schedul",
        ]
    ):
        return "book"

    if any(
        word in clean
        for word in [
            "cheap",
            "budget",
            "afford",
            "save",
        ]
    ):
        return "filter_budget"

    if (
        entities.get("city")
        or entities.get("country")
    ):
        return "search_city"

    return "general_search"


# ============================================================================
# QUERY EXPANSION
# ============================================================================

def expand_query(query_data: dict) -> str:

    expanded = []

    raw = query_data["raw"]
    entities = query_data["entities"]

    if entities.get("name"):

        expanded += [
            entities["name"]
        ]

    elif entities.get("city"):

        expanded += [
            entities["city"],
            "activities",
            "things to do",
            "travel",
        ]

        if entities.get("category"):
            expanded.append(
                entities["category"]
            )

        if entities.get("vibe"):
            expanded.append(
                entities["vibe"]
            )

    elif entities.get("country"):

        expanded += [
            entities["country"]
        ]

        expanded += entities.get(
            "country_cities",
            []
        )

        expanded += [
            "activities",
            "travel",
            "explore",
        ]

        if entities.get("category"):
            expanded.append(
                entities["category"]
            )

    elif entities.get("category"):

        expanded += [
            entities["category"],
            "activity",
            "experience",
            "travel",
        ]

    elif entities.get("travel_style"):

        expanded += [
            entities["travel_style"],
            "trip",
            "activity",
        ]

    elif entities.get("budget_level"):

        expanded += [
            "cheap",
            "budget",
            "affordable",
            "activity",
        ]

    else:

        expanded += [
            raw,
            "travel",
            "activity",
            "experience",
        ]

    return " ".join(expanded)


# ============================================================================
# INPUT PREPROCESSING
# ============================================================================

def preprocess_input(raw: str) -> dict:

    clean = clean_text(raw)

    error = classify_error(
        raw,
        clean
    )

    entities = extract_entities(raw)

    intent = classify_intent(
        clean,
        entities
    )

    word_count = len(
        clean.split()
    )

    if (
        word_count <= 2
        and not entities.get("city")
        and not entities.get("name")
        and not entities.get("country")
    ):

        expanded = expand_query({
            "raw": raw,
            "entities": entities,
        })

    else:

        expanded = clean

    return {
        "raw": raw,
        "clean_text": clean,
        "entities": entities,
        "intent": intent,
        "error_type": error,
        "expanded_query": expanded,
    }


# ============================================================================
# BM25
# ============================================================================

def build_bm25_index(
    df: pd.DataFrame
) -> BM25Okapi:

    corpus = []

    for _, row in df.iterrows():

        parts = []

        columns = [
            "activity_name",
            "city",
            "country",
            "category",
            "travel_style",
            "airline",
            "origin",
            "cabin_class",
            "room_type",
            "vibe",
            "best_season",
            "suitable_for",
        ]

        for column in columns:

            if (
                column in df.columns
                and pd.notna(row.get(column))
            ):

                parts.append(
                    str(row[column])
                )

        if (
            "description" in df.columns
            and pd.notna(row.get("description"))
        ):

            description = str(
                row["description"]
            )

            parts.append(
                " ".join(
                    description.split()[:50]
                )
            )

        for price_col in [
            "price_aud",
            "price_per_night_aud",
        ]:

            if (
                price_col in df.columns
                and pd.notna(row.get(price_col))
            ):

                parts.append(
                    f"{row[price_col]} aud"
                )

                break

        if (
            "rating" in df.columns
            and pd.notna(row.get("rating"))
        ):

            parts.append(
                f"{row['rating']} rating"
            )

        corpus.append(
            " ".join(parts)
            .lower()
            .split()
        )

    return BM25Okapi(corpus)


def get_price_col(
    df: pd.DataFrame
):

    for column in [
        "price_aud",
        "price_per_night_aud",
    ]:

        if column in df.columns:
            return column

    return None


bm25_activities = build_bm25_index(
    activities_df
)

bm25_hotels = build_bm25_index(
    hotels_df
)

bm25_flights = build_bm25_index(
    flights_df
)


print(
    f"✅ BM25 indices built: "
    f"activities={len(activities_df)}, "
    f"hotels={len(hotels_df)}, "
    f"flights={len(flights_df)}"
)


# ============================================================================
# DATABASE GAP
# ============================================================================

def check_db_gap(
    df: pd.DataFrame,
    user_input: dict
) -> bool:

    entities = user_input["entities"]

    city = entities.get("city")
    country = entities.get("country")
    category = entities.get("category")


    if city and "city" in df.columns:

        if not (
            df["city"]
            .astype(str)
            .str.lower()
            .eq(city.lower())
            .any()
        ):

            return True


    elif (
        country
        and not city
        and "country" in df.columns
    ):

        if not (
            df["country"]
            .astype(str)
            .str.lower()
            .eq(country.lower())
            .any()
        ):

            return True


    if (
        category
        and "category" in df.columns
    ):

        mask = (
            df["category"]
            .astype(str)
            .str.lower()
            .str.contains(
                category.lower(),
                regex=False
            )
        )

        if city and "city" in df.columns:

            mask = (
                mask
                & df["city"]
                .astype(str)
                .str.lower()
                .eq(city.lower())
            )

        if not mask.any():

            return True


    return False


# ============================================================================
# DATASET SELECTION
# ============================================================================

def select_dataset(
    user_input: dict
):

    clean = user_input.get(
        "clean_text",
        ""
    ).lower()


    if any(
        word in clean
        for word in [
            "flight",
            "fly",
            "airline",
            "airport",
            "depart",
            "arriv",
        ]
    ):

        return (
            flights_df,
            bm25_flights
        )


    if any(
        word in clean
        for word in [
            "hotel",
            "stay",
            "accommod",
            "room",
            "hostel",
            "resort",
            "lodge",
        ]
    ):

        return (
            hotels_df,
            bm25_hotels
        )


    return (
        activities_df,
        bm25_activities
    )


# ============================================================================
# RETRIEVAL
# ============================================================================

def retrieve(
    df: pd.DataFrame,
    bm25: BM25Okapi,
    user_input: dict,
    top_n: int = 5
) -> list:

    entities = user_input["entities"]


    # ------------------------------------------------------------------------
    # Exact name search
    # ------------------------------------------------------------------------

    if (
        entities.get("name")
        and "activity_name" in df.columns
    ):

        mask = (
            df["activity_name"]
            .astype(str)
            .str.lower()
            .str.contains(
                entities["name"],
                regex=False
            )
        )

        if mask.any():

            return (
                df[mask]
                .head(top_n)
                .to_dict("records")
            )


    # ------------------------------------------------------------------------
    # BM25
    # ------------------------------------------------------------------------

    query = user_input.get(
        "expanded_query",
        user_input.get(
            "clean_text",
            ""
        )
    )

    query_tokens = (
        query
        .lower()
        .split()
    )


    scores = bm25.get_scores(
        query_tokens
    )


    ranked = sorted(
        range(len(scores)),
        key=lambda i: scores[i],
        reverse=True
    )


    results = []

    price_col = get_price_col(df)


    for index in ranked:

        row = df.iloc[index]


        # City filter
        if (
            entities.get("city")
            and "city" in df.columns
        ):

            row_city = str(
                row.get("city", "")
            ).lower()

            if row_city != entities["city"].lower():
                continue


        # Country filter
        elif (
            entities.get("country")
            and not entities.get("city")
            and "country" in df.columns
        ):

            row_country = str(
                row.get("country", "")
            ).lower()

            if (
                row_country
                != entities["country"].lower()
            ):
                continue


        # Category filter
        if (
            entities.get("category")
            and "category" in df.columns
        ):

            row_category = str(
                row.get("category", "")
            ).lower()

            if (
                entities["category"].lower()
                not in row_category
            ):
                continue


        # Maximum price
        if (
            entities.get("max_price")
            and price_col
        ):

            try:

                price = float(
                    row.get(
                        price_col,
                        0
                    )
                )

                if price > entities["max_price"]:
                    continue

            except (
                ValueError,
                TypeError,
            ):
                pass


        # Budget filter
        if (
            entities.get("budget_level")
            == "low"
            and price_col
        ):

            try:

                price = float(
                    row.get(
                        price_col,
                        0
                    )
                )

                if price > 100:
                    continue

            except (
                ValueError,
                TypeError,
            ):
                pass


        results.append(
            row.to_dict()
        )


        if len(results) >= top_n:
            break


    # ------------------------------------------------------------------------
    # Fallback
    # ------------------------------------------------------------------------

    if not results:

        for index in ranked[:top_n]:

            results.append(
                df.iloc[index].to_dict()
            )


    return results


print("✅ Retrieval engine ready")


# ============================================================================
# FORMAT INVENTORY RECORD
# ============================================================================

def format_doc_record(
    record: dict
) -> str:

    parts = []


    # ID
    for key in [
        "activity_id",
        "item_id",
        "item_name",
        "activity_name",
        "airline",
        "hotel_name",
    ]:

        if record.get(key):

            parts.append(
                f"id={record[key]}"
            )

            break


    # Basic metadata
    for field in [
        "activity_name",
        "city",
        "country",
        "category",
        "vibe",
        "best_season",
        "suitable_for",
        "travel_style",
        "cabin_class",
        "room_type",
    ]:

        if record.get(field):

            parts.append(
                f"{field}={record[field]}"
            )


    # Price
    for price_col in [
        "price_aud",
        "price_per_night_aud",
    ]:

        if record.get(price_col) is not None:

            parts.append(
                f"AUD${record[price_col]}"
            )

            break


    # Rating
    if record.get("rating") is not None:

        parts.append(
            f"rating={record['rating']}"
        )


    # Duration
    if record.get("duration_hours"):

        parts.append(
            f"duration={record['duration_hours']} hours"
        )


    # Description
    if record.get("description"):

        description = str(
            record["description"]
        )

        description = description[:160].rstrip()

        parts.append(
            f'desc="{description}"'
        )


    return " | ".join(parts)


# ============================================================================
# DOCUMENT PROMPT
# ============================================================================

def build_doc_prompt(
    session: dict,
    user_input: dict,
    retrieved: list
) -> str:


    if retrieved:

        docs_block = "\n".join(
            f"[{index + 1}] "
            f"{format_doc_record(record)}"
            for index, record
            in enumerate(retrieved)
        )

    else:

        docs_block = (
            "(No matching records found "
            "in the marketplace database)"
        )


    # ------------------------------------------------------------------------
    # Itinerary
    # ------------------------------------------------------------------------

    if session["itinerary"]:

        itinerary_block = "\n".join(

            f"- "
            f"{item.get('item_type', 'item')} | "
            f"{item.get('item_name', '?')} | "
            f"{item.get('city', '?')} | "
            f"AUD${item.get('price_aud', '?')}"

            for item
            in session["itinerary"]
        )

    else:

        itinerary_block = (
            "Empty — itinerary not started yet."
        )


    # ------------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------------

    if session["history"]:

        history_block = "\n".join(

            f"Turn {message['turn']} "
            f"[{message['role']}]: "
            f"{message['content'][:150]}"

            for message
            in session["history"][-4:]
        )

    else:

        history_block = "No history yet."


    error_note = ""

    if user_input.get("error_type"):

        error_note = (
            "\nError type: "
            f"{user_input['error_type']}"
        )


    return f"""
=== INVENTORY CONTEXT ===

Only use the following verified the marketplace inventory.

--- Retrieved Records ---
{docs_block}

--- Current Itinerary ---
{itinerary_block}

--- Conversation History ---
{history_block}

--- Current Request ---
Raw input:
{user_input['raw']}

Expanded query:
{user_input.get('expanded_query', user_input['clean_text'])}

Intent:
{user_input['intent']}

Entities:
{json.dumps(user_input['entities'])}

Turn:
{session['turn'] + 1}

{error_note}
""".strip()


# ============================================================================
# CRITERIA PROMPT
# ============================================================================

def build_criteria_prompt(
    session: dict,
    error_type=None
) -> str:


    profile = session.get(
        "user_profile",
        {}
    )


    budget = profile.get(
        "budget_level",
        "any"
    )

    style = profile.get(
        "travel_style",
        "any"
    )


    feedback = session.get(
        "feedback_log",
        []
    )


    rejected_ids = [
        item["id"]
        for item in feedback
        if item["signal"] == "reject"
    ]


    if rejected_ids:

        rejection_note = (
            "Do not recommend these previously "
            f"rejected IDs: {rejected_ids}"
        )

    else:

        rejection_note = (
            "No rejected items."
        )


    return f"""
=== CO-PILOT CRITERIA ===

You are a travel co-pilot for the marketplace.

Your job is to help the user build a travel itinerary
using ONLY the verified inventory records supplied in
the inventory context.

IMPORTANT:

1. Never invent an activity.
2. Never invent a hotel.
3. Never invent a flight.
4. Never invent a price.
5. Never invent a rating.
6. Never invent availability.
7. Never reference external booking websites.
8. Never mention competitors.
9. Every suggested item MUST come from the retrieved records.
10. Keep the response concise.

USER PROFILE:

Budget:
{budget}

Travel style:
{style}

FEEDBACK:

{rejection_note}


ERROR RULES:

HUMAN_INPUT_ERROR:
- Ask the user to rephrase.
- suggestions must be [].
- error_type must be HUMAN_INPUT_ERROR.

DB_GAP_ERROR:
- The requested destination/category is not covered.
- Be honest.
- Suggest alternatives only from retrieved records.
- error_type must be DB_GAP_ERROR.

DETAIL_REQUEST:
- Give additional information about retrieved items.
- Do not provide external links.
- error_type must be DETAIL_REQUEST.

NORMAL REQUEST:
- Recommend relevant retrieved inventory.
- error_type must be null.


RECOMMENDATION RULES:

Prefer:

- rating >= 4.5
- matching city
- matching category
- matching travel style
- matching budget

Do not recommend an item merely because the model
thinks it sounds good.

The retrieved records are the source of truth.


OUTPUT:

Return ONLY JSON.
Do not explain your reasoning.
Do not use markdown.
Do not use code fences.
""".strip()


# ============================================================================
# OUTPUT FORMAT
# ============================================================================

def build_output_format_prompt() -> str:

    return """
=== OUTPUT FORMAT ===

Return ONLY one valid JSON object.

Use this exact structure:

{
  "error_type": null,
  "next_action": {
    "type": "recommend",
    "label": "Suggest activities",
    "reason": "Short reason."
  },
  "suggestions": [
    {
      "item_id": "ID",
      "item_name": "Name",
      "item_type": "activity",
      "city": "Tokyo",
      "country": "Japan",
      "category": "food",
      "vibe": "",
      "best_season": "",
      "suitable_for": "",
      "duration_hours": 0,
      "price_aud": 0.0,
      "rating": 0.0,
      "why_recommended": "Short reason.",
      "verified": true,
      "confidence": 0.95
    }
  ],
  "auto_fill": {
    "field": null,
    "value": null
  },
  "warnings": [],
  "copilot_message": "Short helpful response."
}


STRICT JSON RULES:

- Output valid JSON only.
- No markdown.
- No ```json.
- No explanation before JSON.
- No explanation after JSON.
- Double quotes only.
- No trailing commas.
- suggestions must contain ONLY retrieved records.
- If no records are available, suggestions must be [].
- confidence must be between 0 and 1.
- price_aud must be numeric.
- rating must be numeric.
- error_type must be null or one of:
    HUMAN_INPUT_ERROR
    DB_GAP_ERROR
    DETAIL_REQUEST
""".strip()


# ============================================================================
# JSON CLEANING
# ============================================================================

def _clean_llm_json(
    raw_text: str
) -> str:

    text = raw_text.strip()


    # Remove markdown code fences
    text = re.sub(
        r"^```(?:json)?\s*",
        "",
        text,
        flags=re.IGNORECASE
    )

    text = re.sub(
        r"\s*```$",
        "",
        text
    )


    text = text.strip()


    # Sometimes Gemini adds text before JSON.
    # Find the first JSON object.
    first_brace = text.find("{")

    if first_brace > 0:

        text = text[first_brace:]


    # Remove trailing comma before } or ]
    text = re.sub(
        r",\s*([}\]])",
        r"\1",
        text
    )


    return text.strip()


# ============================================================================
# JSON VALIDATION
# ============================================================================

def _validate_llm_output(
    result: dict,
    retrieved: list
) -> dict:

    if not isinstance(result, dict):

        return {
            "error": "invalid_llm_output"
        }


    if "suggestions" not in result:

        result["suggestions"] = []


    if "warnings" not in result:

        result["warnings"] = []


    if "auto_fill" not in result:

        result["auto_fill"] = {
            "field": None,
            "value": None
        }


    if "next_action" not in result:

        result["next_action"] = {
            "type": "none",
            "label": "No action",
            "reason": ""
        }


    if "copilot_message" not in result:

        result["copilot_message"] = ""


    # ------------------------------------------------------------------------
    # Verify suggestion IDs
    # ------------------------------------------------------------------------

    valid_ids = set()

    for record in retrieved:

        for key in [
            "activity_id",
            "item_id",
            "id",
        ]:

            if record.get(key) is not None:

                valid_ids.add(
                    str(record[key])
                )


    safe_suggestions = []


    for suggestion in result.get(
        "suggestions",
        []
    ):

        item_id = str(
            suggestion.get(
                "item_id",
                ""
            )
        )


        if item_id in valid_ids:

            suggestion["verified"] = True

            safe_suggestions.append(
                suggestion
            )


    result["suggestions"] = safe_suggestions


    return result


# ============================================================================
# FALLBACK RESPONSE
# ============================================================================

def _fallback_response(
    user_input: dict,
    retrieved: list
) -> dict:

    error_type = (
        user_input.get("error_type")
    )


    # ------------------------------------------------------------------------
    # Human input error
    # ------------------------------------------------------------------------

    if error_type == "HUMAN_INPUT_ERROR":

        return {
            "error_type": "HUMAN_INPUT_ERROR",

            "next_action": {
                "type": "ask_clarification",
                "label": "Clarify your request",
                "reason": "The request could not be understood."
            },

            "suggestions": [],

            "auto_fill": {
                "field": None,
                "value": None
            },

            "warnings": [
                {
                    "code": "HUMAN_INPUT_ERROR",
                    "message": "Please provide a destination or activity type.",
                    "severity": "warning"
                }
            ],

            "copilot_message": (
                "Could you rephrase that with a destination "
                "or activity type?"
            )
        }


    # ------------------------------------------------------------------------
    # No retrieved records
    # ------------------------------------------------------------------------

    if not retrieved:

        return {
            "error_type": error_type,

            "next_action": {
                "type": "ask_clarification",
                "label": "Try another destination",
                "reason": "No matching inventory records were found."
            },

            "suggestions": [],

            "auto_fill": {
                "field": None,
                "value": None
            },

            "warnings": [
                {
                    "code": "NO_MATCH",
                    "message": "No matching the marketplace inventory was found.",
                    "severity": "warning"
                }
            ],

            "copilot_message": (
                "I couldn't find a matching option in the "
                "current the marketplace inventory."
            )
        }


    # ------------------------------------------------------------------------
    # Deterministic fallback
    #
    # This is important:
    # If Gemini is temporarily unavailable, the application still works.
    # ------------------------------------------------------------------------

    suggestions = []


    for record in retrieved[:3]:

        item_id = (
            record.get("activity_id")
            or record.get("item_id")
            or record.get("id")
            or ""
        )


        item_name = (
            record.get("activity_name")
            or record.get("item_name")
            or record.get("hotel_name")
            or record.get("flight_name")
            or "Unnamed option"
        )


        item_type = "activity"

        if record in hotels_df.to_dict("records"):
            item_type = "hotel"

        elif record in flights_df.to_dict("records"):
            item_type = "flight"


        suggestions.append({

            "item_id": str(item_id),

            "item_name": str(item_name),

            "item_type": item_type,

            "city": str(
                record.get(
                    "city",
                    ""
                )
            ),

            "country": str(
                record.get(
                    "country",
                    ""
                )
            ),

            "category": str(
                record.get(
                    "category",
                    ""
                )
            ),

            "vibe": str(
                record.get(
                    "vibe",
                    ""
                )
            ),

            "best_season": str(
                record.get(
                    "best_season",
                    ""
                )
            ),

            "suitable_for": str(
                record.get(
                    "suitable_for",
                    ""
                )
            ),

            "duration_hours": record.get(
                "duration_hours",
                0
            ),

            "price_aud": float(
                record.get(
                    "price_aud",
                    0
                ) or 0
            ),

            "rating": float(
                record.get(
                    "rating",
                    0
                ) or 0
            ),

            "why_recommended": (
                "This option matches the retrieved "
                "inventory for your request."
            ),

            "verified": True,

            "confidence": 0.8,
        })


    return {

        "error_type": error_type,

        "next_action": {
            "type": "recommend",
            "label": "View matching activities",
            "reason": "Matching inventory records were found."
        },

        "suggestions": suggestions,

        "auto_fill": {
            "field": None,
            "value": None
        },

        "warnings": [],

        "copilot_message": (
            "Here are some matching options "
            "from the verified the marketplace inventory."
        )
    }


# ============================================================================
# LLM CALL
# ============================================================================

def call_llm(
    doc_prompt: str,
    criteria_prompt: str,
    output_prompt: str,
    retrieved: list,
    retries: int = 3
) -> dict:

    system_msg = (
        criteria_prompt
        + "\n\n"
        + output_prompt
    )


    # ------------------------------------------------------------------------
    # Retry loop
    #
    # Handles:
    #   Gemini 503
    #   Temporary timeout
    #   Temporary provider failure
    # ------------------------------------------------------------------------

    last_exception = None


    for attempt in range(
        1,
        retries + 1
    ):

        try:

            print(
                f"[LLM] Attempt "
                f"{attempt}/{retries}..."
            )


            response = _llm_call(
                system_prompt=system_msg,
                user_prompt=doc_prompt,
                max_tokens=1200,
            )


            raw_text = response.text


            print(
                f"[LLM] {response.provider} / "
                f"{response.model} | "
                f"{response.tokens_in} in / "
                f"{response.tokens_out} out"
            )


            # --------------------------------------------------------------
            # Empty response
            # --------------------------------------------------------------

            if not raw_text.strip():

                raise ValueError(
                    "LLM returned an empty response."
                )


            # --------------------------------------------------------------
            # Parse JSON
            # --------------------------------------------------------------

            clean = _clean_llm_json(
                raw_text
            )


            try:

                result = json.loads(
                    clean
                )

            except json.JSONDecodeError:

                print(
                    "❌ LLM returned invalid JSON"
                )

                print(
                    "Raw response:"
                )

                print(
                    raw_text
                )

                # ----------------------------------------------------------
                # IMPORTANT:
                #
                # Do NOT crash the entire application.
                #
                # Use deterministic inventory fallback.
                # ----------------------------------------------------------

                return _fallback_response(
                    user_input={
                        "error_type": None
                    },
                    retrieved=retrieved
                )


            # --------------------------------------------------------------
            # Validate
            # --------------------------------------------------------------

            result = _validate_llm_output(
                result,
                retrieved
            )


            # --------------------------------------------------------------
            # Attach LLM metadata
            # --------------------------------------------------------------

            result["_llm"] = {

                "provider": response.provider,

                "model": response.model,

                "tokens_in": response.tokens_in,

                "tokens_out": response.tokens_out,

                "total_tokens": (
                    response.tokens_in
                    + response.tokens_out
                ),
            }


            return result


        except Exception as exc:

            last_exception = exc

            print(
                f"⚠️ LLM attempt "
                f"{attempt} failed: "
                f"{exc}"
            )


            if attempt < retries:

                # Exponential backoff:
                #
                # attempt 1 → 2 sec
                # attempt 2 → 4 sec

                delay = 2 ** attempt

                print(
                    f"[LLM] Retrying in "
                    f"{delay} seconds..."
                )

                time.sleep(
                    delay
                )


    # =========================================================================
    # ALL LLM RETRIES FAILED
    # =========================================================================

    print(
        "❌ All LLM attempts failed."
    )

    print(
        f"Last error: {last_exception}"
    )


    # Return deterministic fallback
    # rather than killing the application.

    fallback = _fallback_response(
        user_input={
            "error_type": None
        },
        retrieved=retrieved
    )


    fallback["_llm"] = {

        "provider": "fallback",

        "model": "none",

        "tokens_in": 0,

        "tokens_out": 0,

        "total_tokens": 0,

        "error": str(
            last_exception
        )
        if last_exception
        else "unknown",
    }


    return fallback


# ============================================================================
# SESSION
# ============================================================================

def create_session() -> dict:

    return {

        "session_id": str(
            uuid.uuid4()
        )[:8],

        "turn": 0,

        "itinerary": [],

        "history": [],

        "user_profile": {},

        "feedback_log": [],
    }


# ============================================================================
# SESSION UPDATE
# ============================================================================

def update_session(
    session: dict,
    user_input: dict,
    llm_output: dict,
    raw_query: str
) -> None:

    turn = session["turn"]


    session["history"].append({

        "role": "user",

        "content": raw_query,

        "turn": turn,
    })


    session["history"].append({

        "role": "assistant",

        "content": llm_output.get(
            "copilot_message",
            ""
        ),

        "turn": turn,
    })


    entities = user_input.get(
        "entities",
        {}
    )


    # Profile
    if entities.get("travel_style"):

        session[
            "user_profile"
        ]["travel_style"] = (
            entities["travel_style"]
        )


    if entities.get("budget_level"):

        session[
            "user_profile"
        ]["budget_level"] = (
            entities["budget_level"]
        )


    if entities.get("city"):

        session[
            "user_profile"
        ]["last_city"] = (
            entities["city"]
        )


    if entities.get("country"):

        session[
            "user_profile"
        ]["last_country"] = (
            entities["country"]
        )


    # ------------------------------------------------------------------------
    # Itinerary
    # ------------------------------------------------------------------------

    action_type = (
        llm_output
        .get("next_action", {})
        .get("type", "")
    )


    error_type = llm_output.get(
        "error_type"
    )


    suggestions = llm_output.get(
        "suggestions",
        []
    )


    if (
        action_type == "recommend"
        and suggestions
        and not error_type
    ):

        top = suggestions[0]

        if top.get("item_name"):

            session[
                "itinerary"
            ].append(top)


    session["turn"] += 1


# ============================================================================
# FEEDBACK
# ============================================================================

def record_feedback(
    session: dict,
    item_id: str,
    signal: str
) -> None:

    session[
        "feedback_log"
    ].append({

        "id": item_id,

        "signal": signal,
    })


    print(
        f"Feedback: "
        f"{item_id} → {signal}"
    )


# ============================================================================
# MAIN COPILOT TURN
# ============================================================================

def copilot_turn(
    session: dict,
    raw_query: str,
    verbose: bool = True
) -> dict:

    print()
    print("=" * 60)

    print(
        f"Turn {session['turn'] + 1} "
        f"| User: {raw_query}"
    )

    print("=" * 60)


    # =========================================================================
    # STEP 1 — NLP
    # =========================================================================

    user_input = preprocess_input(
        raw_query
    )


    # Re-expand after preprocessing
    user_input[
        "expanded_query"
    ] = expand_query(
        user_input
    )


    if verbose:

        print(
            f"[NLP] "
            f"intent={user_input['intent']} "
            f"| entities={user_input['entities']}"
        )


        if user_input.get(
            "error_type"
        ):

            print(
                "[ERROR] Pre-classified: "
                f"{user_input['error_type']}"
            )


    # =========================================================================
    # STEP 2 — DATASET
    # =========================================================================

    df_selected, bm25_selected = (
        select_dataset(
            user_input
        )
    )


    if df_selected is flights_df:

        dataset_label = "flights"

    elif df_selected is hotels_df:

        dataset_label = "hotels"

    else:

        dataset_label = "activities"


    # =========================================================================
    # STEP 3 — DATABASE GAP
    # =========================================================================

    if (
        df_selected is activities_df
        and not user_input.get("error_type")
    ):

        if check_db_gap(
            activities_df,
            user_input
        ):

            user_input[
                "error_type"
            ] = "DB_GAP_ERROR"


            if verbose:

                print(
                    "[ERROR] DB_GAP_ERROR: "
                    "no coverage for "
                    f"city={user_input['entities'].get('city')} "
                    f"/ "
                    f"country={user_input['entities'].get('country')}"
                )


    # =========================================================================
    # STEP 4 — BM25 RETRIEVAL
    # =========================================================================

    retrieved = retrieve(
        df_selected,
        bm25_selected,
        user_input,
        top_n=5
    )


    if verbose:

        print(
            f"[DATASET] "
            f"{dataset_label} "
            f"({len(df_selected)} rows) "
            f"→ {len(retrieved)} retrieved"
        )


    # =========================================================================
    # STEP 5 — BUILD PROMPTS
    # =========================================================================

    doc_prompt = build_doc_prompt(
        session,
        user_input,
        retrieved
    )


    criteria_prompt = build_criteria_prompt(
        session,
        user_input.get(
            "error_type"
        )
    )


    output_prompt = (
        build_output_format_prompt()
    )


    # =========================================================================
    # STEP 6 — LLM
    # =========================================================================

    if verbose:

        print(
            f"[LLM] Calling "
            f"{active_provider()}..."
        )


    result = call_llm(
        doc_prompt=doc_prompt,
        criteria_prompt=criteria_prompt,
        output_prompt=output_prompt,
        retrieved=retrieved,
        retries=3,
    )


    # =========================================================================
    # STEP 7 — SESSION
    # =========================================================================

    update_session(
        session,
        user_input,
        result,
        raw_query
    )


    # =========================================================================
    # STEP 8 — RESULT LOGGING
    # =========================================================================

    if verbose:

        message = result.get(
            "copilot_message",
            ""
        )


        print(
            f"[RESULT] "
            f"{len(message.split())} words"
        )


        if result.get("_llm"):

            llm_info = result["_llm"]

            print(
                f"[LLM] "
                f"{llm_info.get('provider')} / "
                f"{llm_info.get('model')} | "
                f"{llm_info.get('tokens_in', 0)} in / "
                f"{llm_info.get('tokens_out', 0)} out"
            )


    return result


# ============================================================================
# READY
# ============================================================================

print("✅ LLM caller ready")
print("✅ Session memory ready")
print("✅ copilot_turn() ready")


# ============================================================================
# DIRECT TEST
# ============================================================================

if __name__ == "__main__":

    print()
    print("=" * 60)
    print("COPILOT SMOKE TEST")
    print("=" * 60)

    session = create_session()

    result = copilot_turn(
        session,
        "Find me a food activity in Tokyo"
    )

    print()
    print("FINAL RESULT:")
    print(
        json.dumps(
            result,
            indent=2,
            ensure_ascii=False
        )
    )