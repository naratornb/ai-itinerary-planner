import pytest

PERF_VARS = ("LLM_STUB", "LLM_STUB_DELAY_MS", "LLM_STUB_FIXTURE")


@pytest.fixture(autouse=True)
def _clear_perf_stub_env(monkeypatch):
    """An operator mid-perf-run has LLM_STUB=1 exported; the suite must not care."""
    for name in PERF_VARS:
        monkeypatch.delenv(name, raising=False)
