# Influencer Travel Marketplace

[![CI](https://github.com/naratornb/ai-itinerary-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/naratornb/ai-itinerary-planner/actions/workflows/ci.yml)

AI-powered itinerary service for travel influencers. Next.js web app (`apps/web`) + FastAPI API (`apps/api`) backed by [Supabase Cloud](https://supabase.com).

## Setup

1. Create a Supabase project and grab the URL, anon key, and service role key (Settings → API).
2. Configure env — one root `.env` is the single config; apps/api and apps/web load it automatically:

   ```sh
   cp .env.example .env   # fill in the values
   # only if running the Bruno smoke tests — the collection reads the root .env via a symlink:
   ln -s ../../../.env apps/test/fc-itinerary-planner-test-collection/.env
   ```

3. Migrations are applied by the pipeline (see below) — nothing to run locally. To preview
   what a deploy would apply: `supabase link --project-ref <project-ref> && supabase db push --dry-run`.

## Run (dev)

```sh
npm run dev   # starts api + web (runs ./dev.sh); Ctrl-C stops both
```

Or individually:

```sh
# web — http://localhost:3000
cd apps/web && npm install && npm run dev

# api — http://localhost:5001
cd apps/api && pip install -r requirements.txt && uvicorn app.main:app --port 5001 --reload
```

## Database migrations

Schema lives as versioned SQL in [supabase/migrations/](supabase/migrations/). To change it, add a new migration file — the pipeline applies it on deploy; never run `supabase db push` yourself (dry-run preview only), never edit an applied migration, and never alter the DB ad-hoc. See [docs/agents/database.md](docs/agents/database.md).

Row-level security is enforced (`supabase/migrations/0003_rls_policies.sql`); `node scripts/rls.check.mjs` verifies the policies against the live project.

## More

- App-specific READMEs: [apps/api](apps/api/README.md), [apps/web](apps/web/README.md)
- API smoke tests (Bruno): [apps/test/fc-itinerary-planner-test-collection](apps/test/fc-itinerary-planner-test-collection/README.md)
- API spec: [apps/api/openapi.yaml](apps/api/openapi.yaml)
- Contributor / agent guide: [AGENTS.md](AGENTS.md)
