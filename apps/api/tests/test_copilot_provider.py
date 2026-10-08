import json
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.ai import llm_provider as provider


def test_legacy_provider_call_does_not_change_options(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    model = Mock(return_value="reply")
    monkeypatch.setattr(provider, "_call_gemini", model)
    assert provider.call_llm("system", "user", 1000) == "reply"
    model.assert_called_once_with("system", "user", 1000)


def test_provider_failover_uses_remaining_budget(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    clock = iter([1.0, 2.0])
    monkeypatch.setattr(provider.time, "monotonic", lambda: next(clock))
    gemini = Mock(side_effect=RuntimeError("quota"))
    fallback = Mock(return_value="reply")
    monkeypatch.setattr(provider, "_call_gemini", gemini)
    monkeypatch.setattr(provider, "_call_anthropic", fallback)
    assert provider.call_llm("system", "user", deadline=5.0) == "reply"
    assert gemini.call_args.kwargs["timeout"] == 4.0
    assert fallback.call_args.kwargs["timeout"] == 3.0


def test_expired_deadline_never_calls_model(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    model = Mock()
    monkeypatch.setattr(provider, "_call_gemini", model)
    with pytest.raises(RuntimeError):
        provider.call_llm("system", "user", deadline=time.monotonic() - 1)
    model.assert_not_called()


def test_gemini_timeout_and_output_limit_reach_transport(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    response = Mock()
    response.__enter__ = Mock(
        return_value=SimpleNamespace(
            read=lambda: json.dumps(
                {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
            ).encode()
        )
    )
    response.__exit__ = Mock(return_value=False)
    transport = Mock(return_value=response)
    monkeypatch.setattr(provider.urlrequest, "urlopen", transport)
    provider._call_gemini("system", "user", 1500, timeout=3)
    assert transport.call_args.kwargs["timeout"] == 3
    payload = json.loads(transport.call_args.args[0].data)
    assert payload["generationConfig"]["maxOutputTokens"] == 1500
    assert "thinkingConfig" not in payload["generationConfig"]
