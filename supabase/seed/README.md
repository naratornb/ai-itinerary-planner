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
- `02_users_packages.sql` — demo users (`@seed.local`) and their packages.
  **Destructive:** each run deletes every `@seed.local` user and every
  `b0000000-%` package before reinserting. If stakeholders are testing with those
  accounts, that wipes them — use `03_test_users.sql` instead, and consider
  making this file additive too.
- `03_test_users.sql` — six tester accounts (`@test.local`), two each of
  influencer, admin and customer. Additive only: it deletes nothing and is safe
  to re-run, so testers' logins survive a reseed of `02_users_packages.sql`.
  Independent of that file — neither one touches the other's rows.
