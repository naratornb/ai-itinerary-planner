# Influencer Travel Marketplace

AI-powered itinerary service for travel influencers. Runs on a self-hosted Supabase stack via Docker Compose.

## Services

| Service | URL | Role |
| --- | --- | --- |
| Web | http://localhost:3000 | Next.js frontend |
| API | http://localhost:5001 | Flask backend |
| Supabase Studio | http://localhost:8000 | DB admin dashboard |

## Quickstart

```sh
cp .env.example .env       # see "Configure" if the example is missing
docker compose up -d
```

Wait ~30 s for Postgres and Kong to become healthy, then open <http://localhost:3000>.

## Configure

The root `.env` must define at least:

```
POSTGRES_PASSWORD=
JWT_SECRET=
ANON_KEY=
SERVICE_ROLE_KEY=
SUPABASE_PUBLIC_URL=http://localhost:8000
```

If `.env.example` is missing at the repo root, copy the upstream Supabase template at <https://github.com/supabase/supabase/blob/master/docker/.env.example> and follow <https://supabase.com/docs/guides/self-hosting/docker> to generate the JWT keys.

## Database migrations

The app schema lives as versioned SQL migrations in [supabase/migrations/](supabase/migrations/). After `docker compose up -d` is healthy, apply them with the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):

```sh
set -a; source .env; set +a
supabase db push --db-url "postgresql://postgres.${POOLER_TENANT_ID}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
```

- URL-encode `POSTGRES_PASSWORD` in the URL if it contains special characters.
- To change the schema, add a new `supabase/migrations/<UTC-timestamp>_<name>.sql` and push again — never edit an applied migration or alter the DB ad-hoc. See [docs/agents/database.md](docs/agents/database.md).
- The baseline has no row-level security yet; `public` tables are reachable with the anon key via PostgREST. Add RLS policies in a follow-up migration before exposing real data.

## Stop / reset

```sh
docker compose down       # stop, keep data
./reset.sh                # WIPE containers, DB, storage, and .env
```

## Troubleshoot

```sh
docker compose ps               # which services are unhealthy
docker compose logs -f web api  # tail app logs
```

## More

- App-specific READMEs: [apps/api](apps/api/README.md), [apps/web](apps/web/README.md)
- API spec: [docs/openapi.yaml](docs/openapi.yaml)
- Schema: [supabase/migrations/](supabase/migrations/)
- Contributor / agent guide: [AGENTS.md](AGENTS.md)
