"""Render a perf-run directory into a single static HTML report.

Usage:  python report.py <run-dir> [out.html]

Reads from <run-dir>:
  perf-01.json .. perf-04.json   k6 --summary-export output (missing -> row skipped)
  llm_baseline.json              output of llm_baseline.py (optional)
  run_meta.json                  {date, sha, machine, model, stub_delay_ms,
                                  seed_counts, sample?}

Writes a self-contained perf-report.html (inline CSS + SVG, no external
assets) readable by both a technical lead and non-technical leadership.
"""

import html
import json
import sys
from pathlib import Path

# Scenario registry: (file stem, short name, plain-English description,
# p95 threshold ms, error-rate threshold). Thresholds mirror test-plan.md
# and are the single source the report judges against.
SCENARIOS = [
    ("perf-01", "Itinerary generation", "Build a full itinerary (AI stubbed)", 8000, 0.01),
    ("perf-02", "Copilot turn", "One co-pilot suggestion round (AI stubbed)", 5000, 0.01),
    ("perf-03", "Marketplace search", "Browse and search packages (no AI)", 1500, 0.01),
    ("perf-04", "Content validation", "Feasibility checks on a package (no AI)", 2000, 0.01),
]

MS = lambda v: f"{v:,.0f} ms" if v < 10_000 else f"{v/1000:,.1f} s"


def load(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None


def k6_row(data, name, desc, thr_ms, thr_err):
    dur = data["metrics"]["http_req_duration"]
    err = data["metrics"].get("http_req_failed", {}).get("value", 0.0)
    p50, p95 = dur.get("med", dur.get("p(50)", 0)), dur["p(95)"]
    ok = p95 < thr_ms and err < thr_err  # k6 thresholds are strict: p(95)<X, rate<Y
    return dict(name=name, desc=desc, p50=p50, p95=p95, max=dur["max"],
                err=err, thr=thr_ms, thr_err=thr_err, ok=ok,
                reqs=int(data["metrics"].get("http_reqs", {}).get("count", 0)))


# ---------- SVG helpers (palette + specs from the dataviz reference) ----------

def bar_path(x, y, w, h, r=4):
    """Squared start, 4px-rounded data end, anchored at x."""
    w = max(w, r + 1)
    return (f"M{x},{y} h{w - r} q{r},0 {r},{r} v{h - 2 * r} "
            f"q0,{r} -{r},{r} h-{w - r} z")


def latency_chart(rows):
    """Horizontal bars: p95 per scenario, threshold as a dashed marker."""
    left, bw, rh, gap = 170, 470, 22, 16
    max_x = max(max(r["p95"], r["thr"]) for r in rows) * 1.12
    sx = lambda v: v / max_x * bw
    h = len(rows) * (rh + gap) + 34
    parts = [f'<svg viewBox="0 0 700 {h}" role="img" aria-label="p95 latency by scenario against threshold">']
    # gridlines at quarters
    for i in range(1, 5):
        gx = left + bw * i / 4
        parts.append(f'<line x1="{gx:.0f}" y1="4" x2="{gx:.0f}" y2="{h-30}" class="grid"/>')
        parts.append(f'<text x="{gx:.0f}" y="{h-14}" class="tick" text-anchor="middle">{MS(max_x*i/4)}</text>')
    for i, r in enumerate(rows):
        y = i * (rh + gap) + 6
        w = sx(r["p95"])
        label = html.escape(r["name"])
        parts.append(f'<g><title>{label}: p95 {MS(r["p95"])} (threshold {MS(r["thr"])})</title>')
        parts.append(f'<text x="{left-10}" y="{y+rh-6}" class="lbl" text-anchor="end">{label}</text>')
        parts.append(f'<path d="{bar_path(left, y, w, rh)}" class="bar"/>')
        tx = left + sx(r["thr"])
        parts.append(f'<line x1="{tx:.0f}" y1="{y-3}" x2="{tx:.0f}" y2="{y+rh+3}" class="thr"/>')
        parts.append(f'<text x="{left+w+8}" y="{y+rh-6}" class="val">{MS(r["p95"])}</text></g>')
    parts.append(f'<line x1="{left}" y1="2" x2="{left}" y2="{h-30}" class="axis"/>')
    parts.append("</svg>")
    return "".join(parts)


def token_chart(endpoints):
    """Grouped bars per endpoint: tokens in vs out (2 validated slots + legend)."""
    left, bw, rh, gap = 170, 440, 14, 26
    max_x = max(max(e["tokens_in_avg"], e["tokens_out_avg"]) for e in endpoints) * 1.15
    sx = lambda v: v / max_x * bw
    h = len(endpoints) * (2 * rh + 2 + gap) + 52
    parts = [f'<svg viewBox="0 0 700 {h}" role="img" aria-label="Average tokens per call, in versus out">']
    parts.append(f'<g class="legend"><rect x="{left}" y="4" width="10" height="10" rx="2" class="bar"/>'
                 f'<text x="{left+16}" y="13" class="lbl">tokens in</text>'
                 f'<rect x="{left+100}" y="4" width="10" height="10" rx="2" class="bar2"/>'
                 f'<text x="{left+116}" y="13" class="lbl">tokens out</text></g>')
    for i, e in enumerate(endpoints):
        y = i * (2 * rh + 2 + gap) + 30
        label = html.escape(e["name"])
        ti, to = e["tokens_in_avg"], e["tokens_out_avg"]
        parts.append(f'<g><title>{label}: avg {ti:,.0f} in / {to:,.0f} out</title>')
        parts.append(f'<text x="{left-10}" y="{y+rh+4}" class="lbl" text-anchor="end">{label}</text>')
        parts.append(f'<path d="{bar_path(left, y, sx(ti), rh)}" class="bar"/>')
        parts.append(f'<text x="{left+sx(ti)+8}" y="{y+rh-3}" class="val">{ti:,.0f}</text>')
        parts.append(f'<path d="{bar_path(left, y+rh+2, sx(to), rh)}" class="bar2"/>')
        parts.append(f'<text x="{left+sx(to)+8}" y="{y+2*rh-1}" class="val">{to:,.0f}</text></g>')
    parts.append(f'<line x1="{left}" y1="26" x2="{left}" y2="{h-18}" class="axis"/>')
    parts.append("</svg>")
    return "".join(parts)


# --------------------------------- report ---------------------------------

def status(ok):
    return ('<span class="ok">✓ Pass</span>' if ok else '<span class="fail">✕ Fail</span>')


def build(run_dir: Path) -> str:
    meta = load(run_dir / "run_meta.json") or {}
    rows = [k6_row(d, n, desc, t, te)
            for (stem, n, desc, t, te) in SCENARIOS
            if (d := load(run_dir / f"{stem}.json"))]
    base = load(run_dir / "llm_baseline.json")

    passed = sum(r["ok"] for r in rows)
    worst = max(rows, key=lambda r: r["p95"] / r["thr"]) if rows else None
    tiles = [
        ("Load scenarios passed", f"{passed} / {len(rows)}", "AI stubbed — measures our code"),
        ("Slowest scenario (p95)", MS(worst["p95"]) if worst else "—",
         worst["name"] if worst else ""),
        ("Worst error rate", f"{max((r['err'] for r in rows), default=0)*100:.2f}%",
         "across all load scenarios"),
    ]
    if base:
        tiles.append(("Real AI calls spent", f"{base.get('total_calls', 0)}",
                      f"budget cap 40 · {html.escape(base.get('model', ''))}"))

    if not rows:
        verdict = "No load-scenario results found."
    elif passed == len(rows):
        verdict = "All measured scenarios are within their agreed limits."
    else:
        verdict = "One or more scenarios exceeded their agreed limits — details below."

    sample = ('<div class="banner">SAMPLE DATA — illustrative layout only, '
              'not real measurements</div>') if meta.get("sample") else ""

    scen_rows = "".join(
        f"<tr><td>{html.escape(r['name'])}<div class='sub'>{html.escape(r['desc'])}</div></td>"
        f"<td>{MS(r['p50'])}</td><td>{MS(r['p95'])}</td><td>{MS(r['max'])}</td>"
        f"<td>{r['err']*100:.2f}%</td><td>{MS(r['thr'])}</td><td>{status(r['ok'])}</td></tr>"
        for r in rows)

    base_html = ""
    if base:
        base_rows = "".join(
            f"<tr><td>{html.escape(e['name'])}</td><td>{e['calls']}</td>"
            f"<td>{MS(e['p50_ms'])}</td><td>{MS(e['p95_ms'])}</td>"
            f"<td>{e['tokens_in_avg']:,.0f}</td><td>{e['tokens_out_avg']:,.0f}</td>"
            f"<td>{e.get('retries_429', 0)}</td></tr>"
            for e in base["endpoints"])
        # Our API routes don't surface Gemini's usageMetadata yet, so a real run
        # records 0/0 tokens — an all-zero chart is every bar at zero width.
        chart = ""
        if any(e["tokens_in_avg"] or e["tokens_out_avg"] for e in base["endpoints"]):
            chart = f"""<figure>{token_chart(base['endpoints'])}
<figcaption>Average tokens per call by endpoint. Larger “in” bars mean larger
prompts — the main cost driver.</figcaption></figure>"""
        abort_html = (f'<div class="banner">Run aborted — {html.escape(base["aborted"])}</div>'
                      if base.get("aborted") else "")
        base_html = f"""
<section><h2>Real-AI baseline (PERF-05)</h2>
<p class="note">A small, capped sample of real AI calls — run sequentially once per
release. These numbers measure the AI provider and set the regression baseline;
they are not load-test results.</p>
{abort_html}
{chart}
<table><thead><tr><th>Endpoint</th><th>Calls</th><th>p50</th><th>p95</th>
<th>Avg tokens in</th><th>Avg tokens out</th><th>429 retries</th></tr></thead>
<tbody>{base_rows}</tbody></table></section>"""

    meta_bits = " · ".join(filter(None, [
        html.escape(str(meta.get("date", ""))),
        f"commit {html.escape(str(meta.get('sha', ''))[:9])}" if meta.get("sha") else "",
        html.escape(str(meta.get("machine", ""))),
        f"model {html.escape(str(meta.get('model', '')))}" if meta.get("model") else "",
    ]))

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Performance test report{' — SAMPLE' if meta.get('sample') else ''}</title>
<style>
:root {{ color-scheme: light;
  --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e;
  --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7;
  --s1:#2a78d6; --s2:#eb6834; --good:#006300; --crit:#d03b3b;
  --ring:rgba(11,11,11,.10); }}
@media (prefers-color-scheme: dark) {{ :root:where(:not([data-theme="light"])) {{
  color-scheme: dark;
  --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7;
  --muted:#898781; --grid:#2c2c2a; --axis:#383835;
  --s1:#3987e5; --s2:#d95926; --good:#0ca30c; --crit:#e66767;
  --ring:rgba(255,255,255,.10); }} }}
:root[data-theme="dark"] {{ color-scheme: dark;
  --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7;
  --muted:#898781; --grid:#2c2c2a; --axis:#383835;
  --s1:#3987e5; --s2:#d95926; --good:#0ca30c; --crit:#e66767;
  --ring:rgba(255,255,255,.10); }}
* {{ box-sizing:border-box; margin:0; }}
body {{ font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;
  background:var(--page); color:var(--ink); padding:32px 16px; }}
main {{ max-width:820px; margin:0 auto; display:grid; gap:28px; }}
h1 {{ font-size:1.5rem; }} h2 {{ font-size:1.15rem; margin-bottom:10px; }}
.meta,.note,.sub,figcaption {{ color:var(--ink2); font-size:.86rem; }}
.sub {{ font-size:.8rem; }}
.banner {{ background:var(--s2); color:#fff; padding:8px 14px; border-radius:8px;
  font-weight:600; text-align:center; }}
.tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; }}
.tile {{ background:var(--surface); border:1px solid var(--ring); border-radius:10px;
  padding:14px 16px; }}
.tile b {{ display:block; font-size:1.6rem; line-height:1.2; }}
.tile span {{ font-size:.8rem; color:var(--ink2); }}
section {{ background:var(--surface); border:1px solid var(--ring);
  border-radius:10px; padding:20px; }}
figure {{ margin:14px 0; }} svg {{ width:100%; height:auto; display:block; }}
.bar {{ fill:var(--s1); }} .bar2 {{ fill:var(--s2); }}
.grid {{ stroke:var(--grid); stroke-width:1; }}
.axis {{ stroke:var(--axis); stroke-width:1; }}
.thr {{ stroke:var(--ink2); stroke-width:1.5; stroke-dasharray:3 3; }}
.lbl {{ fill:var(--ink2); font:12px system-ui,sans-serif; }}
.tick,.val {{ fill:var(--muted); font:11px system-ui,sans-serif;
  font-variant-numeric:tabular-nums; }}
.val {{ fill:var(--ink2); paint-order:stroke; stroke:var(--surface); stroke-width:3px; }}
table {{ width:100%; border-collapse:collapse; font-size:.88rem; }}
th {{ text-align:left; color:var(--ink2); font-weight:600; }}
th,td {{ padding:8px 10px; border-bottom:1px solid var(--grid);
  font-variant-numeric:tabular-nums; }}
tbody tr:last-child td {{ border-bottom:none; }}
.ok {{ color:var(--good); font-weight:600; }}
.fail {{ color:var(--crit); font-weight:600; }}
.overflow {{ overflow-x:auto; }}
</style></head><body><main>
{sample}
<header><h1>Performance test report</h1>
<p class="meta">{meta_bits}</p></header>

<section><h2>Summary</h2>
<p>{verdict}</p><br>
<div class="tiles">{''.join(f'<div class="tile"><span>{html.escape(t)}</span><b>{html.escape(v)}</b><span>{html.escape(s)}</span></div>' for t, v, s in tiles)}</div>
<p class="note" style="margin-top:12px">How to read this: load scenarios run with
the AI stubbed out, so they measure the speed of <em>our</em> software under
concurrent use. The AI provider's own speed and cost are sampled separately in
the baseline section. “p95” means 95 out of 100 requests finished within that
time.</p></section>

<section><h2>Load scenarios — response time vs agreed limit</h2>
<figure>{latency_chart(rows) if rows else '<p class="note">No scenario results found.</p>'}
<figcaption>Bar = p95 response time · dashed marker = agreed limit. A bar ending
left of its marker is within limits.</figcaption></figure>
<div class="overflow"><table><thead><tr><th>Scenario</th><th>p50</th><th>p95</th>
<th>Max</th><th>Errors</th><th>Limit (p95)</th><th>Result</th></tr></thead>
<tbody>{scen_rows}</tbody></table></div></section>
{base_html}
<footer class="meta">Generated by apps/test/perf/report.py · thresholds are
defined in docs/testing/performance/test-plan.md · self-contained file, safe to
attach or email.</footer>
</main></body></html>"""


def main():
    run_dir = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else run_dir / "perf-report.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(run_dir))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
