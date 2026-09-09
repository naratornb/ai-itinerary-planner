// Optional isolated migration check; no connection to a Supabase project.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { PGlite } = await import(process.argv[2] || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const db = new PGlite();
await db.exec(`
 CREATE ROLE authenticated; CREATE ROLE anon;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
 GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
 CREATE TABLE public.travel_packages(package_id uuid PRIMARY KEY, creator_id uuid NOT NULL);
 INSERT INTO public.travel_packages VALUES ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
 GRANT SELECT ON public.travel_packages TO authenticated;
`);
await db.exec(readFileSync(root+'/supabase/migrations/0012_package_copilot.sql','utf8'));
await db.exec(readFileSync(root+'/apps/api/tests/copilot_rls.sql','utf8'));
console.log('PASS: migration, atomic rollback, owner RLS, immutable snapshots, single feedback transition, anonymous denial');
await db.close();
