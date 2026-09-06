from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

QUERY = "5 day food trip to Tokyo for 2 travellers"

# Minimal engine output: every field the response model does not require is
# absent, and one numeric is NaN — what pandas yields for a null in a numeric
# column. Both are real fallback-path shapes, not hypotheticals.
SPARSE_ITINERARY = {
    "meta": {"trip_id": "t1"},
    "trip": {"title": "Tokyo"},
    "description": "A short trip.",
    "flights": [{"flight_id": "f1", "price_aud": float("nan")}],
    "accommodation": [],
    "days": [],
    "bookable": True,
}


@pytest.mark.parametrize("body", [{"query": "   "}, {"query": ""}, {}])
def test_blank_query_is_rejected_before_the_engine_runs(body):
    """A whitespace-only query must not reach Supabase or Gemini."""
    with patch("app.ai.router.generate_itinerary") as engine:
        response = client.post("/ai/recommend", json=body)

    assert response.status_code == 422
    assert response.json()["error_code"] == "VALIDATION_ERROR"
    engine.assert_not_called()


@pytest.mark.parametrize(
    ("exc", "status", "error_code"),
    [
        (EnvironmentError("SUPABASE_URL missing"), 500, "CONFIG_ERROR"),
        (Exception("google api returned 429"), 429, "RATE_LIMITED"),
        (Exception("Quota exceeded for model"), 429, "RATE_LIMITED"),
        (Exception("connection reset"), 502, "LLM_FAILURE"),
    ],
)
def test_engine_failures_map_to_the_shared_error_shape(exc, status, error_code):
    with patch("app.ai.router.generate_itinerary", side_effect=exc):
        response = client.post("/ai/recommend", json={"query": QUERY})

    assert response.status_code == status
    body = response.json()
    assert body["error_code"] == error_code
    # Upstream detail is logged, never returned.
    assert str(exc) not in body["message"]


def test_sparse_engine_output_still_serialises():
    """response_model must not turn a valid-but-sparse itinerary into a 500."""
    with patch("app.ai.router.generate_itinerary", return_value=SPARSE_ITINERARY):
        response = client.post("/ai/recommend", json={"query": QUERY})

    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["trip_id"] == "t1"
    # NaN is not JSON-compliant — it has to come back as null, not blow up.
    assert body["flights"][0]["price_aud"] is None


def test_query_is_stripped_before_reaching_the_engine():
    with patch("app.ai.router.generate_itinerary", return_value=SPARSE_ITINERARY) as engine:
        client.post("/ai/recommend", json={"query": f"  {QUERY}  "})

    engine.assert_called_once_with(QUERY, origin_city="Sydney")
