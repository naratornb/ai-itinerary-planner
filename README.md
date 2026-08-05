# Influencer Travel Marketplace

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

## Run (dev)

```sh
# web — http://localhost:3000
cd apps/web && npm install && npm run dev

# api — http://localhost:5001
cd apps/api && pip install -r requirements.txt && flask run --port 5001
```

## Database migrations

Schema lives as versioned SQL in [supabase/migrations/](supabase/migrations/). To change it, add a new `supabase/migrations/<UTC-timestamp>_<name>.sql` and `supabase db push` — never edit an applied migration or alter the DB ad-hoc. See [docs/agents/database.md](docs/agents/database.md).

The baseline has no row-level security yet; `public` tables are reachable with the anon key via PostgREST. Add RLS policies in a follow-up migration before exposing real data.

## More

- App-specific READMEs: [apps/api](apps/api/README.md), [apps/web](apps/web/README.md)
- API spec: [docs/openapi.yaml](docs/openapi.yaml)
- Contributor / agent guide: [AGENTS.md](AGENTS.md)
