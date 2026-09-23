"""Tests for report.py.  Run: python3 apps/test/perf/test_report.py

Plain asserts, no framework — same style as test_llm_baseline.py. Each test
writes a tiny run-dir into a temp directory and checks the rendered HTML.
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import report  # noqa: E402

BASELINE = {
    "total_calls": 10, "model": "gemini-3.6-flash",
    "endpoints": [{"name": "Itinerary generation", "calls": 10, "p50_ms": 1000,
                   "p95_ms": 2000, "tokens_in_avg": 900, "tokens_out_avg": 400,
                   "retries_429": 0}],
}


def render(**files):
    """Write {stem: obj} into a temp run-dir and return the built HTML."""
    with tempfile.TemporaryDirectory() as tmp:
        run_dir = Path(tmp)
        for stem, obj in files.items():
            (run_dir / f"{stem}.json").write_text(json.dumps(obj))
        return report.build(run_dir)


def k6(p95, err=0.0):
    return {"metrics": {"http_req_duration": {"med": p95 / 2, "p(95)": p95, "max": p95},
                        "http_req_failed": {"value": err},
                        "http_reqs": {"count": 100}}}


def test_zero_token_guard():
    """Nonzero tokens -> chart; all-zero -> no chart, table still rendered."""
    html = render(llm_baseline=BASELINE)
    assert "Average tokens per call" in html, "nonzero tokens should chart"
    assert "Itinerary generation" in html

    zeroed = json.loads(json.dumps(BASELINE))
    zeroed["endpoints"][0].update(tokens_in_avg=0, tokens_out_avg=0)
    html = render(llm_baseline=zeroed)
    assert "Average tokens per call" not in html, "all-zero should not chart"
    assert "Itinerary generation" in html, "table is kept regardless"


def test_abort_banner():
    aborted = dict(BASELINE, aborted="Copilot turn: HTTP 429 rate limited")
    html = render(llm_baseline=aborted)
    assert "Run aborted — Copilot turn: HTTP 429 rate limited" in html, html[:200]
    assert "Run aborted" not in render(llm_baseline=BASELINE)


def test_threshold_boundary_is_strict():
    """Exactly on the limit is a fail, matching k6's p(95)<X threshold."""
    thr = report.SCENARIOS[0][3]
    assert not report.k6_row(k6(thr), *report.SCENARIOS[0][1:])["ok"], "== limit fails"
    assert report.k6_row(k6(thr - 1), *report.SCENARIOS[0][1:])["ok"]
    assert not report.k6_row(k6(1, err=0.01), *report.SCENARIOS[0][1:])["ok"], "== err fails"


def test_no_data_verdict():
    html = render(llm_baseline=BASELINE)
    assert "No load-scenario results found." in html
    assert "exceeded their agreed limits" not in html


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all passed")
