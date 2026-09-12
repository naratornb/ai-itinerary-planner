"""Co-pilot contract checks with no real database or model requests."""

import copy
import json
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import requests
from fastapi.testclient import TestClient

from app import core
from app.ai import llm_provider
from app.copilot import service
from app.copilot.retrieval import normalize, retrieve
from app.copilot.router import require_copilot_ctx
from app.main import app
from app.packages.service import UpstreamError

client = TestClient(app)
PACKAGE = "b0000000-0000-0000-0000-000000000001"
OTHER = "b0000000-0000-0000-0000-000000000002"
USER = "a0000000-0000-0000-0000-000000000001"
BASE = f"/ai/copilot/{PACKAGE}/turns"
ACTIVITY = {
    "activity_id": "AC-1",
    "activity_name": "Tokyo Food Tour",
    "city": "Tokyo",
    "country": "Japan",
    "category": "Food",
    "price_aud": 80,
    "rating": 4.8,
}
HOTEL = {
    "hotel_id": "HT-1",
    "hotel_name": "Tokyo Hotel",
    "city": "Tokyo",
    "country": "Japan",
    "price_per_night_aud": 90,
}
FLIGHT = {
    "flight_id": "FL-1",
    "airline": "Example Air",
    "destination": "Tokyo (NRT)",
    "destination_country": "Japan",
    "price_aud": 300,
}


class Response:
    def __init__(self, rows, total=0):
        self.rows = rows
        self.headers = {"Content-Range": f"0/{total}"}

    def json(self):
        return copy.deepcopy(self.rows)


@pytest.fixture
def db(monkeypatch):
    turns, calls = [], []

    def call(method, table, headers, deadline, **kwargs):
        assert headers["Authorization"] == "Bearer owner"
        calls.append((method, table, kwargs))
        params = kwargs.get("params", {})
        package = params.get("package_id", f"eq.{PACKAGE}")[3:]
        if table == "travel_packages":
            assert params["creator_id"] == f"eq.{USER}"
            return Response(
                [
                    {
                        "package_id": PACKAGE,
                        "title": "Tokyo",
                        "destination_city": "Tokyo",
                        "destination_country": "Japan",
                        "package_activities": [],
                    }
                ]
                if package == PACKAGE
                else []
            )
        if table in {"activities", "hotels", "flights"}:
            return Response(
                {"activities": [ACTIVITY], "hotels": [HOTEL], "flights": [FLIGHT]}[
                    table
                ]
            )
        if table == "copilot_turns":
            found = [
                t
                for t in reversed(turns)
                if t["package_id"] == package
                and ("turn_id" not in params or t["turn_id"] == params["turn_id"][3:])
            ]
            return Response(
                found[params.get("offset", 0) :][: params.get("limit", 100)], len(found)
            )
        if table == "copilot_suggestions":
            if "turn.package_id" in params:
                assert params["turn.package_id"] == f"eq.{PACKAGE}"
                return Response(
                    [
                        s
                        for t in turns
                        for s in t["suggestions"]
                        if s["status"] == "dismissed"
                    ]
                )
            found = [
                s
                for t in turns
                if t["turn_id"] == params["turn_id"][3:]
                for s in t["suggestions"]
                if s["item_id"] == params["item_id"][3:]
            ]
            if method == "PATCH":
                found = [s for s in found if s["status"] == "pending"]
                for s in found:
                    s["status"] = kwargs["json"]["status"]
            return Response(found)
        if table == "rpc/save_copilot_turn":
            p = kwargs["json"]
            row = {
                "turn_id": p["p_turn_id"],
                "package_id": p["p_package_id"],
                "prompt": p["p_prompt"],
                "context": p["p_context"],
                "result": p["p_result"],
                "suggestions": p["p_suggestions"],
                "response_time_ms": p["p_response_time_ms"],
                "created_at": "2026-09-09T00:00:00Z",
            }
            turns.append(row)
            return Response(row)
        raise AssertionError(table)

    monkeypatch.setattr(service, "_call", call)
    model = Mock(side_effect=RuntimeError("quota exhausted with secret details"))
    monkeypatch.setattr(llm_provider, "call_llm", model)

    def context():
        started = time.monotonic()
        return {
            "uid": USER,
            "headers": {"Authorization": "Bearer owner"},
            "started": started,
            "deadline": started + 10,
        }

    app.dependency_overrides[require_copilot_ctx] = context
    yield SimpleNamespace(turns=turns, calls=calls, model=model, context=context)
    app.dependency_overrides.clear()


def test_fallback_is_persisted_and_prices_are_authoritative(db):
    response = client.post(BASE, json={"prompt": "Tokyo food under $100"})
    assert response.status_code == 201
    body = response.json()
    assert body["generation_mode"] == "inventory_fallback"
    assert body["suggestions"][0]["price_aud"] == 80
    assert body["suggestions"][0]["price_unit"] == "per_person"
    assert "secret" not in response.text
    assert len(db.turns) == 1
    assert db.model.call_args.kwargs["max_tokens"] == 3000


def test_verified_model_selects_ids_only(db):
    db.model.side_effect = None
    db.model.return_value = llm_provider.LLMResponse(
        json.dumps(
            {
                "message": "Review this food experience.",
                "next_action": {"type": "recommend", "label": "Review"},
                "selections": [{"item_id": "AC-1", "why_recommended": "Food in Tokyo"}],
            }
        ),
        "gemini",
        "configured-model",
        20,
        30,
    )
    body = client.post(BASE, json={"prompt": "Japan"}).json()
    assert body["generation_mode"] == "llm"
    assert body["suggestions"][0]["item_name"] == ACTIVITY["activity_name"]
    assert body["suggestions"][0]["details"] == ACTIVITY


@pytest.mark.parametrize(
    "output",
    [
        "not json",
        '{"message": "invented"}',
        json.dumps(
            {
                "message": "Review",
                "next_action": {"type": "recommend", "label": "Review"},
                "selections": [{"item_id": "FAKE", "why_recommended": "invented"}],
            }
        ),
    ],
)
def test_bad_model_output_falls_back(db, output):
    db.model.side_effect = None
    db.model.return_value = llm_provider.LLMResponse(
        output, "gemini", "configured", 1, 1
    )
    body = client.post(BASE, json={"prompt": "Tokyo"}).json()
    assert body["generation_mode"] == "inventory_fallback"
    assert [s["item_id"] for s in body["suggestions"]] == ["AC-1"]


@pytest.mark.parametrize("prompt", ["", "   ", "x" * 1001])
def test_prompt_validation_prevents_work(db, prompt):
    assert client.post(BASE, json={"prompt": prompt}).status_code == 422
    assert not db.calls


def test_unknown_package_is_hidden(db):
    assert (
        client.post(f"/ai/copilot/{OTHER}/turns", json={"prompt": "Japan"}).status_code
        == 404
    )
    db.model.assert_not_called()


def test_followup_context_and_per_item_feedback(db):
    first = client.post(BASE, json={"prompt": "Tokyo food"}).json()
    item_url = f"{BASE}/{first['turn_id']}/items/AC-1"
    assert (
        client.patch(
            item_url, json={"status": "accepted", "auto_apply": True}
        ).status_code
        == 422
    )
    assert db.turns[0]["suggestions"][0]["status"] == "pending"
    assert client.patch(item_url, json={"status": "dismissed"}).status_code == 200
    assert client.patch(item_url, json={"status": "accepted"}).status_code == 409
    following = client.post(BASE, json={"prompt": "cheap options"}).json()
    assert following["generation_mode"] == "clarification"
    assert not following["suggestions"]
    assert db.turns[-1]["context"]["city"] == "Tokyo"
    assert not any(
        method in {"POST", "PATCH"} and table.startswith("package")
        for method, table, _ in db.calls
    )


def test_history_pagination_and_foreign_turn(db):
    first = client.post(BASE, json={"prompt": "Tokyo"}).json()
    client.post(BASE, json={"prompt": "hotels"})
    history = client.get(BASE + "?page=2&per_page=1").json()
    assert history["meta"]["total"] == 2
    assert history["data"][0]["turn_id"] == first["turn_id"]
    assert client.get(f"/ai/copilot/{OTHER}/turns").status_code == 404
    assert (
        client.patch(
            f"{BASE}/{OTHER}/items/AC-1", json={"status": "accepted"}
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"{BASE}/{first['turn_id']}/items/missing", json={"status": "accepted"}
        ).status_code
        == 404
    )


def test_save_failure_does_not_claim_success(db, monkeypatch):
    original = service._call

    def fail(method, table, *args, **kwargs):
        if table == "rpc/save_copilot_turn":
            raise UpstreamError(503, "Database unreachable.")
        return original(method, table, *args, **kwargs)

    monkeypatch.setattr(service, "_call", fail)
    assert client.post(BASE, json={"prompt": "Tokyo"}).status_code == 503
    assert not db.turns


def test_no_generation_time_left_skips_provider(db):
    ctx = db.context()
    ctx["deadline"] = time.monotonic() + 1
    result = service.create_turn(PACKAGE, "Tokyo", ctx)
    assert result.generation_mode == "inventory_fallback"
    db.model.assert_not_called()


def test_auth_rejects_missing_and_expired_tokens(monkeypatch):
    monkeypatch.setattr(core, "SUPABASE_ANON_KEY", "anon")
    monkeypatch.setattr(core, "SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(core, "SUPABASE_URL", "https://example.test")
    get = Mock(return_value=SimpleNamespace(ok=False))
    monkeypatch.setattr(core.requests, "get", get)
    assert client.get(BASE).status_code == 401
    get.assert_not_called()
    assert (
        client.get(BASE, headers={"Authorization": "Bearer expired"}).status_code == 401
    )
    assert get.call_args.kwargs["timeout"] == 5


def test_database_timeout_respects_remaining_budget(monkeypatch):
    request = Mock(side_effect=requests.Timeout())
    monkeypatch.setattr(service.requests, "request", request)
    with pytest.raises(UpstreamError, match="Database unreachable"):
        service._call("GET", "activities", {}, time.monotonic() + 1)
    assert 0 < request.call_args.kwargs["timeout"] <= 0.5


def test_retrieval_hard_filters_and_missing_fields():
    inventory = [
        normalize("activity", ACTIVITY),
        normalize("hotel", HOTEL),
        normalize("flight", FLIGHT),
        normalize(
            "activity",
            {**ACTIVITY, "activity_id": "AC-2", "city": "Paris", "country": "France"},
        ),
    ]
    candidates, _, _ = retrieve("Japan hotels under $100", {}, {}, inventory, set())
    assert [c.item_id for c in candidates] == ["HT-1"]
    assert candidates[0].rating is None
    assert candidates[0].price_unit == "per_night"
    assert not retrieve("Tokyo food under $50", {}, {}, inventory, set())[0]
    assert not retrieve(
        "food in Mongolia", {"destination_city": "Tokyo"}, {}, inventory, set()
    )[0]
    assert not retrieve("Japan", {}, {}, inventory, {"AC-1"})[0]
    assert retrieve("flights to Tokyo", {}, {}, inventory, set())[0][0].city == "Tokyo"


def test_punctuation_only_requests_do_not_call_provider(db):
    response = client.post(BASE, json={"prompt": "!!!"})
    assert response.json()["generation_mode"] == "clarification"
    db.model.assert_not_called()


def test_external_link_output_falls_back(db):
    db.model.side_effect = None
    db.model.return_value = llm_provider.LLMResponse(
        json.dumps(
            {
                "message": "Book at https://outside.example",
                "next_action": {"type": "recommend", "label": "Review"},
                "selections": [{"item_id": "AC-1", "why_recommended": "Food"}],
            }
        ),
        "gemini",
        "configured",
        1,
        1,
    )
    body = client.post(BASE, json={"prompt": "Tokyo"}).json()
    assert body["generation_mode"] == "inventory_fallback"
    assert "outside.example" not in json.dumps(body)


def test_next_step_uses_saved_package_instead_of_acceptance():
    inventory = [
        normalize("activity", ACTIVITY),
        normalize("hotel", HOTEL),
        normalize("flight", FLIGHT),
    ]
    package = {
        "destination_city": "Tokyo",
        "package_activities": [{"activity_id": "AC-1"}],
        "package_hotels": [],
        "package_flights": [],
    }
    candidates, context, reason = retrieve(
        "what next", package, {"item_type": "activity"}, inventory, set()
    )
    assert reason is None
    assert context["item_type"] == "hotel"
    assert candidates[0].item_id == "HT-1"
    package["package_hotels"] = [{"hotel_id": "HT-1"}]
    candidates, _, reason = retrieve("next step", package, context, inventory, set())
    assert reason is None
    assert candidates[0].item_id == "FL-1"
