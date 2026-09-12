# Seed data

## Generated — do not edit by hand

- `flights.csv`
- `hotels.csv`
- `activities.csv`
- `01_catalog.sql`

All four are produced by `scripts/generate-catalog-seed.mjs`, which is
deterministic (seeded PRNG): rerunning it produces byte-identical output.

```sh
node scripts/generate-catalog-seed.mjs
```

Any row you add to these files by hand is destroyed the next time someone runs
that command, silently and without a merge conflict. Add rows to the generator
instead, or to a hand-maintained file below.

## Hand-maintained

- `flights_extended_v2.csv` — 16,521 extra flight rows used by the AI itinerary
  builder. Same column order as `flights.csv`; flight IDs do not collide with
  the generated set. Not produced by the generator, so it survives a regen.
- `02_users_packages.sql`
