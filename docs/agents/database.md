# Database Migrations

How schema changes are made in this repo. This applies to every collaborator — human or AI agent.

## The one rule

**Every schema change is a migration file.** Never alter the database directly via Supabase Studio, `psql`, PostgREST RPC, or ad-hoc SQL. If a change isn't recorded in `supabase/migrations/`, it doesn't exist — the next collaborator's environment won't have it.

## Making a schema change

1. Create a new file: `supabase/migrations/<version>_<short-kebab-name>.sql`
   - Version format: zero-padded sequence number, one higher than the latest existing migration (e.g. `0003_add_rls_policies.sql`)
   - One migration per logical change.
   - Migrations apply in lexicographic order of the version prefix. If two branches claim the same number, the later-merged branch renumbers before merging.
2. Apply it to the linked Supabase Cloud project:
   ```sh
   supabase link --project-ref <project-ref>   # once per clone
   supabase db push
   ```
3. Commit the migration file in the same PR as the code that depends on it. Commit type: `feat:` or `chore:` per `AGENTS.md`.

## Rules

- **Append-only.** Never edit or delete a migration that has been applied anywhere (including a teammate's machine). To fix a mistake, write a new migration that corrects it.
- **`supabase/migrations/` is the single source of truth** for the app schema. Don't create parallel schema files in `docs/` or elsewhere; keep ERDs/diagrams pointing at the migrations.
- If PostgREST doesn't see a new table/column, reload it: `NOTIFY pgrst, 'reload schema';`.
- **ERD stays in sync, versioned by migration number.** The ER diagram in `docs/fc_db_diagrams.excalidraw` carries a `Schema vNNNN — <date>` label where `NNNN` = the latest migration sequence number. Any PR adding a migration that changes tables/columns updates the diagram and bumps this label in the same PR (grep the file for `Schema v` to find it).

## Verifying

```sh
supabase migration list
```

Applied versions are tracked in the `supabase_migrations.schema_migrations` table. Re-running `db push` is idempotent — "Remote database is up to date" means you're in sync.
