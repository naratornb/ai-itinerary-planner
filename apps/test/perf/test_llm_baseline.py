"""Tests for llm_baseline.py.  Run: python3 apps/test/perf/test_llm_baseline.py

Plain asserts, no framework — the script has no dependencies and neither should
its tests. Nothing here touches the network: every run injects a fake caller.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import llm_baseline as lb  # noqa: E402

EP = [{"key": "recommend", "name": "Itinerary generation", "url": "http://x", "payload": {}},
      {"key": "copilot", "name": "Copilot turn", "url": "http://x", "payload": {}},
      {"key": "content", "name": "Content generation", "url": "http://x", "payload": {}},
      {"key": "extra", "name": "Fourth endpoint", "url": "http://x", "payload": {}},
      {"key": "extra2", "name": "Fifth endpoint", "url": "http://x", "payload": {}}]

ok = lambda url, payload, token: (200, '{"listing":"hi"}')
quiet = lambda *args: None  # keeps run()'s per-call progress out of test output


def test_output_shape():
    """Aggregation produces exactly the keys report.py reads."""
    samples = [(float(ms), 100, 50) for ms in range(1000, 2000, 100)]  # n=10
    row = lb.summarize("Itinerary generation", samples, retries_429=0)
    assert set(row) == {"name", "calls", "p50_ms", "p95_ms",
                        "tokens_in_avg", "tokens_out_avg", "retries_429"}, row
    assert row["calls"] == 10 and row["p50_ms"] == 1400 and row["p95_ms"] == 1900, row
    assert row["tokens_in_avg"] == 100 and row["tokens_out_avg"] == 50, row

    result = lb.run(EP[:1], caller=ok, log=quiet)
    assert set(result) == {"total_calls", "model", "endpoints"}, result
    assert result["total_calls"] == 10 and isinstance(result["model"], str), result
    assert result["endpoints"][0]["tokens_in_avg"] == 0, "no usageMetadata -> 0"


def test_call_cap():
    """5 endpoints x 10 calls would be 50; the hard cap stops it at 40."""
    calls = []
    result = lb.run(EP, caller=lambda u, p, t: (calls.append(u), ok(u, p, t))[1], log=quiet)
    assert len(calls) == lb.MAX_TOTAL_CALLS, len(calls)
    assert result["total_calls"] == lb.MAX_TOTAL_CALLS, result["total_calls"]
    assert result["endpoints"][-1]["calls"] == 0, "5th endpoint gets no budget"


def test_429_aborts():
    """A 429 on call 3 stops the whole run, not just that endpoint."""
    n = []

    def caller(url, payload, token):
        n.append(url)
        return (429, '{"error_code":"RATE_LIMITED"}') if len(n) == 3 else ok(url, payload, token)

    result = lb.run(EP, caller=caller, log=quiet)
    assert len(n) == 3, n
    assert result["total_calls"] == 3, result
    assert "aborted" in result and "rate limited" in result["aborted"], result
    assert result["endpoints"][0]["retries_429"] == 1, result
    assert len(result["endpoints"]) == 1, "later endpoints never run"

    # The API's 200-with-RATE_LIMITED body aborts the same way.
    body = (200, '{"error_code":"RATE_LIMITED","message":"AI provider quota exceeded."}')
    assert "aborted" in lb.run(EP[:1], caller=lambda u, p, t: body, log=quiet)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all passed")
