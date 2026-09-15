-- Minimal stand-ins for the Supabase-managed objects the migrations assume.
-- Applied to a disposable local Postgres BEFORE supabase/migrations/*.sql so
-- the schema can be replayed and apps/api/tests/package_editor_persistence.sql
-- can run without touching a real Supabase project.
--
-- ponytail: stubs only what the migrations actually reference. Not a Supabase
-- emulator — if a future migration uses more of auth/storage, add it here.

-- Roles the migrations GRANT/REVOKE against.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

-- auth schema: users table + uid() as used by RLS policies and profiles FKs.
CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id            UUID PRIMARY KEY,
  email         TEXT UNIQUE,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Real Supabase reads the JWT claim. Locally it returns the session setting so
-- a test can impersonate a creator with:
--   SELECT set_config('request.jwt.claim.sub', '<uuid>', true);
CREATE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- storage schema: buckets/objects and the foldername() helper used by policies.
CREATE SCHEMA storage;

CREATE TABLE storage.buckets (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  public             BOOLEAN NOT NULL DEFAULT false,
  file_size_limit    BIGINT,
  allowed_mime_types TEXT[],
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE storage.objects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  TEXT REFERENCES storage.buckets (id),
  name       TEXT,
  owner      UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;
