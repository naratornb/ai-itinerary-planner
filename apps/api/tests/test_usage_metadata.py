from unittest.mock import patch

from fastapi.testclient import TestClient

from app.ai import engine
from app.ai.llm_provider import LLMResponse
from app.main import app

client = TestClient(app)


def test_engine_call_llm_returns_the_full_response(monkeypatch):
    """The wrapper used to return .text only, discarding token counts."""
    stub = LLMResponse(text="{}", provider="stub", model="stub", tokens_in=5, tokens_out=7)
    monkeypatch.setattr(engine, "_llm_call", lambda *a, **k: stub)
    resp = engine.call_llm("system", "user")
    assert resp.text == "{}"
    assert (resp.tokens_in, resp.tokens_out) == (5, 7)


def test_recommend_response_passes_usage_metadata_through():
    """extra="allow" on the response model must keep the usageMetadata key."""
    itinerary = {
        "meta": {"trip_id": "t1"},
        "trip": {"title": "Tokyo"},
        "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 22},
    }
    with patch("app.ai.router.generate_itinerary", return_value=itinerary):
        response = client.post("/ai/recommend", json={"query": "3 days in Tokyo"})
    assert response.status_code == 200
    assert response.json()["usageMetadata"] == {
        "promptTokenCount": 11,
        "candidatesTokenCount": 22,
    }
