-- ============================================================
-- Consolidate public.users into auth.users + public.profiles
--
-- public.users (BIGINT identity) is replaced by public.profiles,
-- a 1:1 extension of auth.users (UUID). All FKs are repointed.
-- No app code reads public.users and no seed path exists, so the
-- dependent tables are expected to be empty of user references.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. profiles — carries the data columns of the old public.users
--    (email stays on auth.users; is_admin was dead backward-compat)
-- ─────────────────────────────────────────────
CREATE TABLE public.profiles (
  id          UUID          PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name   TEXT,
  role        TEXT          NOT NULL DEFAULT 'influencer'
                            CHECK (role IN ('influencer', 'admin', 'customer')),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. Auto-create a profile row for every new auth user
-- ─────────────────────────────────────────────
CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─────────────────────────────────────────────
-- 3. Backfill profiles for auth users that already exist
-- ─────────────────────────────────────────────
INSERT INTO public.profiles (id, full_name, avatar_url)
SELECT id, raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'avatar_url'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 4. Repoint FK columns: BIGINT → UUID, users(id) → profiles(id)
--    USING NULL is safe only on empty tables; a NOT NULL violation
--    here means unexpected manual data — the push aborts, fix by hand.
-- ─────────────────────────────────────────────
ALTER TABLE influencer_profiles
  DROP CONSTRAINT influencer_profiles_user_id_fkey,
  ALTER COLUMN user_id TYPE UUID USING NULL::UUID,
  ADD CONSTRAINT influencer_profiles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE travel_packages
  DROP CONSTRAINT travel_packages_creator_id_fkey,
  ALTER COLUMN creator_id TYPE UUID USING NULL::UUID,
  ADD CONSTRAINT travel_packages_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES public.profiles (id) ON DELETE CASCADE;

ALTER TABLE package_media
  DROP CONSTRAINT package_media_uploaded_by_fkey,
  ALTER COLUMN uploaded_by TYPE UUID USING NULL::UUID,
  ADD CONSTRAINT package_media_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES public.profiles (id);

ALTER TABLE package_approvals
  DROP CONSTRAINT package_approvals_admin_id_fkey,
  ALTER COLUMN admin_id TYPE UUID USING NULL::UUID,
  ADD CONSTRAINT package_approvals_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES public.profiles (id);

ALTER TABLE package_reviews
  DROP CONSTRAINT package_reviews_customer_id_fkey,
  ALTER COLUMN customer_id TYPE UUID USING NULL::UUID,
  ADD CONSTRAINT package_reviews_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.profiles (id);

-- ─────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- No INSERT/DELETE policies: the SECURITY DEFINER trigger inserts,
-- and deletion cascades from auth.users.

-- ─────────────────────────────────────────────
-- 6. Drop the old table (all dependents repointed above)
-- ─────────────────────────────────────────────
DROP TABLE public.users;
