"""
routes/ai_routes.py — FastAPI endpoints for the AI modules
===========================================================
Register in app/main.py:

    from routes.ai_routes import router as ai_router
    app.include_router(ai_router)

Only the Itinerary Builder is wired up here. Co-Pilot joins the same
router when you get to DEV-37-8.
"""

import time
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai.itinerary_engine import generate_itinerary

router = APIRouter(prefix="/api/ai", tags=["ai"])


class RecommendRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Natural-language trip request")
    origin_city: str = Field("Sydney", description="Departure city")


@router.post("/recommend")
def recommend(body: RecommendRequest) -> dict:
    """
    POST /api/ai/recommend
        { "query": "5 day food trip to Tokyo for 2 travellers", "origin_city": "Sydney" }

    Returns the itinerary JSON from itinerary_engine.generate_itinerary().

    Declared with `def`, not `async def`, on purpose: generate_itinerary()
    is synchronous and slow (Supabase fetch, BM25, Gemini). FastAPI runs a
    plain `def` handler in a threadpool, so it will not block the event loop.
    """
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail={"error": "missing_query"})

    started = time.time()

    try:
        result = generate_itinerary(query, origin_city=body.origin_city)

    except EnvironmentError as exc:
        # Missing SUPABASE_URL / SUPABASE_KEY / GEMINI_API_KEY
        raise HTTPException(
            status_code=500,
            detail={"error": "config_error", "detail": str(exc)},
        ) from exc

    except Exception as exc:                                   # noqa: BLE001
        message = str(exc)
        traceback.print_exc()

        if "429" in message or "quota" in message.lower():
            raise HTTPException(
                status_code=429,
                detail={"error": "rate_limited", "retry_after": 30},
            ) from exc

        raise HTTPException(
            status_code=502,
            detail={"error": "llm_failure", "detail": message},
        ) from exc

    elapsed = time.time() - started
    days = result.get("days", [])

    print(
        f"[ai/recommend] {elapsed:.1f}s | origin={body.origin_city} | "
        f"days={len(days)} | "
        f"activities={sum(len(d.get('activities', [])) for d in days)} | "
        f"query={query[:60]}"
    )

    return result