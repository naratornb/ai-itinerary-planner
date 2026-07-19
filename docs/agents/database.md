# Database Migrations

How schema changes are made in this repo. This applies to every collaborator — human or AI agent.

## The one rule

**Every schema change is a migration file.** Never alter the database directly via Supabase Studio, `psql`, PostgREST RPC, or ad-hoc SQL. If a change isn't recorded in `supabase/migrations/`, it doesn't exist — the next collaborator's environment won't have it, and `reset.sh` will silently destroy it.

## Making a schema change

1. Create a new file: `supabase/migrations/<UTC-timestamp>_<short-kebab-name>.sql`
   - Timestamp format: `YYYYMMDDHHMMSS` (e.g. `20260719143000_add_rls_policies.sql`)
   - One migration per logical change.
2. Apply it:
   ```sh
   set -a; source .env; set +a
   supabase db push --db-url "postgresql://postgres.${POOLER_TENANT_ID}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
   ```
3. Commit the migration file in the same PR as the code that depends on it. Commit type: `feat:` or `chore:` per `AGENTS.md`.

## Rules

- **Append-only.** Never edit or delete a migration that has been applied anywhere (including a teammate's machine). To fix a mistake, write a new migration that corrects it.
- **`supabase/migrations/` is the single source of truth** for the app schema. Don't create parallel schema files in `docs/` or elsewhere; keep ERDs/diagrams pointing at the migrations.
- Supabase infrastructure SQL (roles, JWT, realtime — `volumes/db/*.sql`) is not part of app migrations; leave it alone.
- If PostgREST doesn't see a new table/column, reload it: `docker compose restart rest` (or `NOTIFY pgrst, 'reload schema';`).

## Verifying

```sh
supabase migration list --db-url "postgresql://postgres.${POOLER_TENANT_ID}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"
```

Applied versions are tracked in the `supabase_migrations.schema_migrations` table. Re-running `db push` is idempotent — "Remote database is up to date" means you're in sync.
