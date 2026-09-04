import json
import glob

for f in sorted(glob.glob("run_*.json")):

    d = json.load(open(f))

    days = d.get("days", [])

    acts = [
        a
        for x in days
        for a in x.get("activities", [])
    ]

    print(
        f"{f} days={len(days)} "
        f"empty={sum(1 for x in days if not x.get('activities'))} "
        f"acts={len(acts)} "
        f"fallback={'LLM was unavailable' in d.get('description', '')}"
    )
