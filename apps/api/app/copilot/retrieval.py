"""Small-catalog retrieval; only inventory values become destination facts."""

import re

from rank_bm25 import BM25Plus

from app.ai.engine import normalize_city
from app.copilot.schemas import Suggestion

TABLES = {"activity": "activities", "hotel": "hotels", "flight": "flights"}
TYPE_WORDS = {
    "activity": r"\b(activit(?:y|ies)|experience|food|culture|adventure|relaxation|tour)\b",
    "hotel": r"\b(hotel|hotels|accommodation|stay|room)\b",
    "flight": r"\b(flight|flights|fly|airline|transport)\b",
}
STOP = set(
    "i me my a an the to in at for of and or please want find show suggest something next what step should do more cheap under budget aud experience activities activity".split()
)


def tokens(text: str) -> list[str]:
    return [word for word in re.findall(r"[^\W\d_]+", text.lower()) if word not in STOP]


def contains(text: str, term: str) -> bool:
    return bool(re.search(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text, re.I))


def normalize(kind: str, row: dict) -> Suggestion:
    return Suggestion(
        item_id=row[f"{kind}_id"],
        item_type=kind,
        item_name=str(
            row.get(f"{kind}_name") or row.get("airline") or row[f"{kind}_id"]
        ),
        city=normalize_city(row.get("destination" if kind == "flight" else "city")),
        country=row.get("destination_country" if kind == "flight" else "country"),
        price_aud=row.get("price_per_night_aud" if kind == "hotel" else "price_aud"),
        price_unit="per_night" if kind == "hotel" else "per_person",
        rating=row.get("star_rating" if kind == "hotel" else "rating"),
        details=row,
        why_recommended="Matches the requested inventory filters.",
    )


def retrieve(
    prompt: str,
    package: dict,
    previous: dict,
    inventory: list[Suggestion],
    dismissed: set[str],
) -> tuple[list[Suggestion], dict, str | None]:
    """Return candidates, resolved context, and optional clarification reason.

    ponytail: scan the small live catalog per turn; move filtering/indexing to
    Postgres if inventory grows enough to threaten the request budget.
    """
    prompt = re.sub(r"\badventurous\b", "adventure", prompt, flags=re.I)
    context = dict(previous)
    if not re.search(r"[^\W\d_]", prompt):
        return [], context, "Please describe a destination or type of experience."
    cities = {item.city for item in inventory if item.city}
    countries = {item.country for item in inventory if item.country}
    found_cities = sorted(city for city in cities if contains(prompt, city))
    found_countries = sorted(
        country for country in countries if contains(prompt, country)
    )
    if len(found_cities) > 1 or len(found_countries) > 1:
        return [], context, "Please choose one destination for this suggestion."
    if found_cities or found_countries:
        context["city"] = found_cities[0] if found_cities else None
        context["country"] = found_countries[0] if found_countries else None
    else:
        # Do not silently use the saved destination for an unknown explicit place.
        place = re.search(r"\b(?:in|to|visit|visiting)\s+([\w '-]+)", prompt, re.I)
        if place and not any(contains(place[1], p) for p in cities | countries):
            return (
                [],
                context,
                "That destination is not recognised in the inventory. Please specify a catalog city or country.",
            )
        context.setdefault("city", normalize_city(package.get("destination_city")))
        context.setdefault("country", package.get("destination_country"))
    if not context.get("city") and not context.get("country"):
        return [], context, "Which city or country would you like suggestions for?"
    types = [
        kind for kind, pattern in TYPE_WORDS.items() if re.search(pattern, prompt, re.I)
    ]
    if len(types) > 1:
        return (
            [],
            context,
            "Would you like activities, accommodation, or flights first?",
        )
    if types:
        context["item_type"] = types[0]
    next_type = next(
        (kind for kind, table in TABLES.items() if not package.get(f"package_{table}")),
        "activity",
    )
    if not types and re.search(r"\b(?:what.*next|next step)\b", prompt, re.I):
        context["item_type"] = next_type
    context.setdefault("item_type", next_type)
    price = re.search(
        # Bounded \s{0,20} and \d{1,9}: three adjacent unbounded optional
        # whitespace groups made this backtrack on "under" plus a long
        # run of spaces (CodeQL).
        r"(?:under|below|up to|max(?:imum)?|budget(?: of)?)\s{0,20}"
        r"(?:AUD\s{0,20})?\$?\s{0,20}(\d{1,9}(?:\.\d{1,2})?)"
        r"|\$\s{0,20}(\d{1,9}(?:\.\d{1,2})?)",
        prompt,
        re.I,
    )
    if price:
        context["max_price"] = float(price[1] or price[2])
    elif re.search(r"\b(cheap|budget|affordable)\b", prompt, re.I):
        context["max_price"] = 100.0
    if re.search(r"\b(no budget|any price|remove budget)\b", prompt, re.I):
        context.pop("max_price", None)
    kind = context["item_type"]
    categories = {
        str(i.details.get("category")) for i in inventory if i.details.get("category")
    }
    category = next((c for c in sorted(categories) if contains(prompt, c)), None)
    if category:
        context["category"] = category
    if re.search(r"\b(any category|anything|all activities)\b", prompt, re.I):
        context.pop("category", None)
    styles = [s for s in ("solo", "couple", "family", "group") if contains(prompt, s)]
    if styles:
        context["style"] = styles[0]
    candidates = []
    for item in inventory:
        if item.item_type != kind or item.item_id in dismissed:
            continue
        if context.get("city") and item.city.casefold() != context["city"].casefold():
            continue
        if (
            context.get("country")
            and (item.country or "").casefold() != context["country"].casefold()
        ):
            continue
        if context.get("max_price") is not None and (
            item.price_aud is None or item.price_aud > context["max_price"]
        ):
            continue
        if (
            kind == "activity"
            and context.get("category")
            and str(item.details.get("category", "")).casefold()
            != context["category"].casefold()
        ):
            continue
        if kind == "activity" and context.get("style"):
            suitability = str(item.details.get("suitable_for") or "")
            if not contains(suitability, context["style"]) and not contains(
                suitability, "all"
            ):
                continue
        candidates.append(item)
    if not candidates:
        return (
            [],
            context,
            "No inventory matches these filters. Try another destination, category, or budget.",
        )
    query = tokens(prompt)
    # A short unknown query must not turn into an unrelated recommendation.
    vocabulary = {
        word
        for item in candidates
        for word in tokens(" ".join(str(v) for v in item.details.values()))
    }
    if query and not set(query) & (
        vocabulary
        | set(
            "hotel hotels flight flights fly accommodation stay room adventurous romantic adventurousness details tell that this options couple family solo group any price remove category anything all".split()
        )
    ):
        return (
            [],
            context,
            "Please clarify the destination or type of experience you want.",
        )
    corpus = [
        tokens(" ".join(str(v) for v in item.details.values())) or [item.item_id]
        for item in candidates
    ]
    scores = BM25Plus(corpus).get_scores(query)
    ranked = sorted(
        zip(candidates, scores),
        key=lambda pair: (-float(pair[1]), -(pair[0].rating or 0), pair[0].item_id),
    )
    return [item for item, _ in ranked[:5]], context, None
