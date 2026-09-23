import time
from unittest.mock import Mock

import pytest

from app.ai import llm_provider as provider


def test_stub_returns_fixture_without_calling_the_provider(monkeypatch, tmp_path):
    fixture = tmp_path / "reply.json"
    fixture.write_text('{"days": []}', encoding="utf-8")
    monkeypatch.setenv("LLM_STUB", "1")
    monkeypatch.setenv("LLM_STUB_FIXTURE", str(fixture))
    monkeypatch.setenv("GEMINI_API_KEY", "bogus")
    response = provider.call_llm("system", "user")
    assert response.text == '{"days": []}'
    assert response.provider == "stub"
    assert response.total_tokens == 0


def test_stub_without_fixture_returns_canned_value(monkeypatch):
    monkeypatch.setenv("LLM_STUB", "1")
    monkeypatch.delenv("LLM_STUB_FIXTURE", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "bogus")
    assert provider.call_llm("system", "user").text == "{}"


def test_unset_stub_still_calls_the_provider(monkeypatch):
    monkeypatch.delenv("LLM_STUB", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    model = Mock(return_value="reply")
    monkeypatch.setattr(provider, "_call_gemini", model)
    assert provider.call_llm("system", "user", 1000) == "reply"
    model.assert_called_once_with("system", "user", 1000)


def test_stub_delay_is_applied(monkeypatch):
    monkeypatch.setenv("LLM_STUB", "1")
    monkeypatch.delenv("LLM_STUB_FIXTURE", raising=False)
    monkeypatch.setenv("LLM_STUB_DELAY_MS", "50")
    started = time.monotonic()
    provider.call_llm("system", "user")
    assert time.monotonic() - started >= 0.05


def test_stub_raises_on_an_exhausted_deadline(monkeypatch):
    """Same rule as the real path: at or past the 0.05 s floor, raise."""
    monkeypatch.setenv("LLM_STUB", "1")
    monkeypatch.delenv("LLM_STUB_FIXTURE", raising=False)
    monkeypatch.setenv("LLM_STUB_DELAY_MS", "5000")
    with pytest.raises(TimeoutError, match="budget exhausted"):
        provider.call_llm("system", "user", deadline=time.monotonic() + 0.05)


def test_stub_delay_never_outlives_the_deadline(monkeypatch):
    monkeypatch.setenv("LLM_STUB", "1")
    monkeypatch.delenv("LLM_STUB_FIXTURE", raising=False)
    monkeypatch.setenv("LLM_STUB_DELAY_MS", "5000")
    started = time.monotonic()
    provider.call_llm("system", "user", deadline=started + 0.2)
    assert time.monotonic() - started < 0.5


def test_stub_delay_must_be_an_integer(monkeypatch):
    monkeypatch.setenv("LLM_STUB", "1")
    monkeypatch.setenv("LLM_STUB_DELAY_MS", "fast")
    with pytest.raises(ValueError, match="LLM_STUB_DELAY_MS"):
        provider.call_llm("system", "user")
