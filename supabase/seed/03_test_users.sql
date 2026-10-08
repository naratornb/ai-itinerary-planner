-- Tester accounts: two each of influencer, admin and customer.
-- Run: psql "$DATABASE_URL" -f supabase/seed/03_test_users.sql
-- All tester users: password "Password123!", emails end in @test.local.
--
-- ADDITIVE ONLY — this file never deletes a user. Stakeholders test with the
-- accounts already in this database, so re-running must not disturb them.
-- Idempotency comes from the insert guards below, not from a cleanup block:
-- do not add a DELETE here, and do not widen the UPDATEs to a LIKE pattern.
-- (Note 02_users_packages.sql does still wipe its own '%@seed.local' users on
-- every run; that is its behaviour, not a pattern to copy.)

BEGIN;

-- ---------- auth users (trigger creates public.profiles) ----------
-- Token columns must be '' not NULL: GoTrue scans them into non-nullable Go
-- strings, and a NULL makes every admin/auth query touching the row fail.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  email, crypt('Password123!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name), now(), now(),
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('c0000000-0000-0000-0000-000000000001'::uuid, 'tester.influencer1@test.local', 'Tester Influencer One'),
  ('c0000000-0000-0000-0000-000000000002'::uuid, 'tester.influencer2@test.local', 'Tester Influencer Two'),
  ('c0000000-0000-0000-0000-000000000003'::uuid, 'tester.admin1@test.local',      'Tester Admin One'),
  ('c0000000-0000-0000-0000-000000000004'::uuid, 'tester.admin2@test.local',      'Tester Admin Two'),
  ('c0000000-0000-0000-0000-000000000005'::uuid, 'tester.customer1@test.local',   'Tester Customer One'),
  ('c0000000-0000-0000-0000-000000000006'::uuid, 'tester.customer2@test.local',   'Tester Customer Two')
) AS u(id, email, full_name)
-- Skip an email that already exists under a different id, so a hand-edited row
-- cannot trip the unique index on auth.users.email.
WHERE NOT EXISTS (SELECT 1 FROM auth.users e WHERE e.email = u.email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%@test.local'
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id);

-- ---------- roles ----------
-- handle_new_user() already created each profile with role 'influencer', so the
-- two influencer testers need no UPDATE. Keyed by explicit id, never by LIKE.
UPDATE public.profiles SET role = 'admin'
  WHERE id IN ('c0000000-0000-0000-0000-000000000003',
               'c0000000-0000-0000-0000-000000000004');
UPDATE public.profiles SET role = 'customer'
  WHERE id IN ('c0000000-0000-0000-0000-000000000005',
               'c0000000-0000-0000-0000-000000000006');
UPDATE public.profiles SET avatar_url = 'https://i.pravatar.cc/150?u=' || id::text
  WHERE avatar_url IS NULL AND id::text LIKE 'c0000000-%';

-- ---------- influencer profiles ----------
-- DO NOTHING so a hand-edited bio on an existing tester survives a re-run.
INSERT INTO public.influencer_profiles (user_id, bio, instagram_handle, follower_count, specialty, verified) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Test account for influencer flows — verified creator.', '@tester.one', 120000, 'food & culture', TRUE),
  ('c0000000-0000-0000-0000-000000000002', 'Test account for influencer flows — unverified creator.', '@tester.two', 4200, 'adventure', FALSE)
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
