from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.ai import engine
from app.ai.llm_provider import LLMResponse
from app.copilot.service import read_turn
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


def _turn_row(result_extras: dict) -> dict:
    return {
        "turn_id": str(uuid4()),
        "package_id": str(uuid4()),
        "prompt": "Suggest something",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "suggestions": [],
        "response_time_ms": 1200,
        "result": {
            "message": "Here you go.",
            "next_action": {"type": "none", "label": "No action"},
            "warnings": [],
            "generation_mode": "llm",
            **result_extras,
        },
    }


def test_turn_with_usage_metadata_exposes_it():
    usage = {"promptTokenCount": 3000, "candidatesTokenCount": 900}
    turn = read_turn(_turn_row({"usageMetadata": usage}))
    assert turn.usageMetadata == usage


def test_turn_persisted_before_the_change_reads_as_none():
    turn = read_turn(_turn_row({}))
    assert turn.usageMetadata is None
