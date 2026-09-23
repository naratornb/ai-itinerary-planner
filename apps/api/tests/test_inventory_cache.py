import pandas as pd
import pytest

from app.ai import engine


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    """Module globals persist across tests in a process; reset per test."""
    monkeypatch.setattr(engine, "_INVENTORY", None)
    monkeypatch.setattr(engine, "_INVENTORY_AT", 0.0)


def _fake_fetch(calls):
    def fetch():
        calls.append(1)
        df = pd.DataFrame()
        return df, df, df
    return fetch


def test_second_call_within_ttl_does_not_refetch(monkeypatch):
    calls = []
    monkeypatch.setattr(engine, "_fetch_inventory", _fake_fetch(calls))
    first = engine._load_inventory()
    second = engine._load_inventory()
    assert len(calls) == 1
    assert second is first  # same tuple object — served from cache


def test_expired_ttl_refetches(monkeypatch):
    calls = []
    monkeypatch.setattr(engine, "_fetch_inventory", _fake_fetch(calls))
    monkeypatch.setenv("INVENTORY_CACHE_TTL_S", "0")
    engine._load_inventory()
    engine._load_inventory()
    assert len(calls) == 2
