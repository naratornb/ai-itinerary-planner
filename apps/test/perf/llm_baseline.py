"""PERF-05 — real-LLM latency & token baseline. Sequential, capped, stdlib only.

Usage:  python3 apps/test/perf/llm_baseline.py [--out out/llm_baseline.json]
                [--endpoints recommend,copilot,content] [--package-id UUID]
                [--record-fixtures apps/test/perf/fixtures]

Env: API_BASE (default http://localhost:8000), WEB_BASE (http://localhost:3000),
     TOKEN (sent as `Authorization: Bearer`), GEMINI_MODEL.

Never run this in CI and never concurrently — see
docs/testing/performance/ai-token-strategy.md §4 for the budget rules this
script enforces (40-call cap, first 429 aborts the run).
"""

import argparse
import json
import math
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

CALLS_PER_ENDPOINT = 10
MAX_TOTAL_CALLS = 40

API_BASE = os.environ.get("API_BASE", "http://localhost:8000").rstrip("/")
WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3000").rstrip("/")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")

# Small-inventory requests on purpose (ai-token-strategy.md §6): real runs pay
# per token, so they sample a realistic trip, not the pathological maximum.
PAYLOADS = {
    "recommend": {
        "query": "5 day trip to Tokyo in March for two people, mid-range budget",
        "origin_city": "Sydney",
    },
    "copilot": {"prompt": "Suggest a better afternoon activity for day 2."},
    "content": {
        "scope": "day",
        "packageTitle": "Tokyo Discovery",
        "destination": "Tokyo",
        "selectedHotel": "Shinjuku Central Hotel",
        "dayTitle": "Old town and skyline",
        "dayNumber": 1,
        "totalDays": 5,
        "items": ["Senso-ji Temple", "Nakamise shopping street", "Tokyo Skytree"],
        "vibe": "Culture, culinary discoveries, and iconic landmarks",
    },
}


def post(url, payload, token):
    """The one network seam. Tests inject a fake with this signature."""
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def endpoints_for(names, package_id):
    """[{key, name, url, payload}] for the requested endpoint keys."""
    specs = {
        "recommend": ("Itinerary generation", f"{API_BASE}/ai/recommend"),
        "copilot": ("Copilot turn", f"{API_BASE}/ai/copilot/{package_id}/turns"),
        "content": ("Content generation", f"{WEB_BASE}/api/ai/generate-content"),
    }
    out = []
    for key in names:
        if key == "copilot" and not package_id:
            print("skipping copilot: --package-id not given")
            continue
        label, url = specs[key]
        out.append({"key": key, "name": label, "url": url, "payload": PAYLOADS[key]})
    return out


def tokens(body):
    """(prompt, output) token counts from a response body.

    Routes surface usageMetadata as of this branch, so nonzero token counts
    are expected on successful LLM-backed responses. A 0/0 reading now indicates
    either the LLM stub or a passthrough regression.
    """
    try:
        usage = json.loads(body).get("usageMetadata") or {}
    except (ValueError, AttributeError):
        return 0, 0
    return usage.get("promptTokenCount", 0), usage.get("candidatesTokenCount", 0)


def rate_limited(status, body):
    # ponytail: plain substring match, so a 200 whose payload happens to contain
    # "RATE_LIMITED" also aborts. Fine at 40 calls; parse the error_code field if
    # a legitimate body ever carries the string.
    return status == 429 or "RATE_LIMITED" in body


def pct(values, p):
    """Nearest-rank percentile. Plenty at n=10; no interpolation games."""
    ordered = sorted(values)
    return ordered[max(1, math.ceil(p / 100 * len(ordered))) - 1] if ordered else 0


def summarize(name, samples, retries_429=0):
    """samples: [(ms, tokens_in, tokens_out)] for one endpoint."""
    avg = lambda i: round(sum(s[i] for s in samples) / len(samples)) if samples else 0
    return {
        "name": name,
        "calls": len(samples),
        "p50_ms": round(pct([s[0] for s in samples], 50)),
        "p95_ms": round(pct([s[0] for s in samples], 95)),
        "tokens_in_avg": avg(1),
        "tokens_out_avg": avg(2),
        "retries_429": retries_429,
    }


def run(endpoints, token=None, caller=post, fixtures_dir=None,
        calls_per_endpoint=CALLS_PER_ENDPOINT, max_total=MAX_TOTAL_CALLS,
        log=print):
    """Sequential capped run. Returns the llm_baseline.json dict.

    log: progress printer; pass a no-op to silence it (the tests do).
    """
    total, rows, aborted = 0, [], None
    for ep in endpoints:
        samples, n429, recorded = [], 0, False
        for _ in range(calls_per_endpoint):
            if total >= max_total:
                break
            started = time.perf_counter()
            status, body = caller(ep["url"], ep["payload"], token)
            elapsed_ms = (time.perf_counter() - started) * 1000
            total += 1
            if rate_limited(status, body):
                n429 += 1
                aborted = (f"{ep['name']}: HTTP {status} rate limited after "
                           f"{total} call(s) — run aborted (ai-token-strategy.md §4)")
                break
            if status >= 400:
                log(f"  {ep['name']}: HTTP {status} — {body[:200]}")
                continue
            if fixtures_dir and not recorded:
                Path(fixtures_dir).mkdir(parents=True, exist_ok=True)
                (Path(fixtures_dir) / f"{ep['key']}.json").write_text(body)
                recorded = True
            tin, tout = tokens(body)
            samples.append((elapsed_ms, tin, tout))
            log(f"  {ep['name']}: {elapsed_ms:,.0f} ms ({total}/{max_total})")
        rows.append(summarize(ep["name"], samples, n429))
        if aborted:
            break
    result = {"total_calls": total, "model": MODEL, "endpoints": rows}
    if aborted:
        result["aborted"] = aborted
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="out/llm_baseline.json")
    ap.add_argument("--endpoints", default="recommend,copilot,content",
                    help="comma-separated subset of recommend,copilot,content")
    ap.add_argument("--package-id", help="package UUID for the copilot endpoint")
    ap.add_argument("--record-fixtures", metavar="DIR",
                    help="save each endpoint's first raw response body to DIR")
    args = ap.parse_args()

    names = [n.strip() for n in args.endpoints.split(",") if n.strip()]
    unknown = set(names) - set(PAYLOADS)
    if unknown:
        ap.error(f"unknown endpoint(s): {', '.join(sorted(unknown))}")

    result = run(
        endpoints_for(names, args.package_id),
        token=os.environ.get("TOKEN"),
        fixtures_dir=args.record_fixtures,
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1))
    if "aborted" in result:
        print(f"ABORTED — {result['aborted']}")
    print(f"wrote {out} ({result['total_calls']} real calls spent)")


if __name__ == "__main__":
    main()
