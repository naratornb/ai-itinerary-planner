# Influencer Travel Marketplace

[![CI](https://github.com/naratornb/ai-itinerary-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/naratornb/ai-itinerary-planner/actions/workflows/ci.yml)

AI-powered itinerary service for travel influencers. Next.js web app (`apps/web`) + Flask API (`apps/api`) backed by [Supabase Cloud](https://supabase.com).

## Setup

1. Create a Supabase project and grab the URL, anon key, and service role key (Settings → API).
2. Configure env — one root `.env` for everything:

   ```sh
   cp .env.example .env                    # fill in the values
   ln -sf ../../.env apps/web/.env.local   # Next.js only reads env from its own dir
   ```

3. Apply migrations:

   ```sh
   supabase link --project-ref <project-ref>
   supabase db push
   ```

4. Seed the AI feasibility rules (migrations create the `feasibility_rules` table, but leave it empty):

   ```sh
   apps/web/node_modules/.bin/tsx scripts/seed-feasibility-rules.mjs
   ```

## Run (dev)

```sh
npm run dev   # starts api + web (runs ./dev.sh); Ctrl-C stops both
```

Or individually:

```sh
# web — http://localhost:3000
cd apps/web && npm install && npm run dev

# api — http://localhost:5001
cd apps/api && pip install -r requirements.txt && flask run --port 5001
```

## Database migrations

Schema lives as versioned SQL in [supabase/migrations/](supabase/migrations/). To change it, add a new `supabase/migrations/<UTC-timestamp>_<name>.sql` and `supabase db push` — never edit an applied migration or alter the DB ad-hoc. See [docs/agents/database.md](docs/agents/database.md).

The baseline has no row-level security yet; `public` tables are reachable with the anon key via PostgREST. Add RLS policies in a follow-up migration before exposing real data.

`feasibility_rules` is the exception: it's admin-write-only, so it's never populated by a SQL seed file. `scripts/seed-feasibility-rules.mjs` upserts the rule set from `apps/web/lib/feasibility.ts`'s `FALLBACK_RULES` into whichever project your `.env`'s `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` point at — run it once after migrating, and again any time a rule's wording changes.

## More

- App-specific READMEs: [apps/api](apps/api/README.md), [apps/web](apps/web/README.md)
- API spec: [apps/api/openapi.yaml](apps/api/openapi.yaml)
- Contributor / agent guide: [AGENTS.md](AGENTS.md)
