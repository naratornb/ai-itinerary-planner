-- ============================================================
-- Row Level Security policies for all remaining tables
--
-- profiles already has RLS + policies from 0002; only an anon
-- SELECT policy is added here (marketplace embeds creator names).
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Helper: is the current user an admin?
-- ─────────────────────────────────────────────
CREATE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$;

-- ─────────────────────────────────────────────
-- 2. Enable RLS on every table that lacks it
-- ─────────────────────────────────────────────
ALTER TABLE public.influencer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flights             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_packages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_flights     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_hotels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_activities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_media       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_approvals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_suggestions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_reviews     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feasibility_rules   ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- 3. profiles — anon read (creator names on public marketplace)
-- ─────────────────────────────────────────────
CREATE POLICY "Profiles are viewable by anon"
  ON public.profiles FOR SELECT
  TO anon
  USING (TRUE);

-- ─────────────────────────────────────────────
-- 4. Catalog tables — public read, no writes via API
-- ─────────────────────────────────────────────
CREATE POLICY "Flights are viewable by everyone"
  ON public.flights FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Hotels are viewable by everyone"
  ON public.hotels FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Activities are viewable by everyone"
  ON public.activities FOR SELECT
  TO anon, authenticated
  USING (TRUE);

-- ─────────────────────────────────────────────
-- 5. feasibility_rules — public read, admin write
-- ─────────────────────────────────────────────
CREATE POLICY "Feasibility rules are viewable by everyone"
  ON public.feasibility_rules FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Admins manage feasibility rules"
  ON public.feasibility_rules FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────
-- 6. travel_packages — live packages public; owners and admins
--    see and manage everything of theirs
-- ─────────────────────────────────────────────
CREATE POLICY "Live packages are viewable, owners and admins see all"
  ON public.travel_packages FOR SELECT
  TO anon, authenticated
  USING (status = 'live' OR creator_id = auth.uid() OR public.is_admin());

CREATE POLICY "Owners and admins manage packages"
  ON public.travel_packages FOR ALL
  TO authenticated
  USING (creator_id = auth.uid() OR public.is_admin())
  WITH CHECK (creator_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────
-- 7. Package child tables — visibility and ownership follow the
--    parent package via travel_packages' own RLS.
--    ponytail: parent ownership is the whole boundary here —
--    package_media.uploaded_by is not separately checked; add
--    per-column checks if contributor roles ever split.
-- ─────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['package_flights', 'package_hotels', 'package_activities', 'package_media']
  LOOP
    EXECUTE format($f$
      CREATE POLICY "Rows of visible packages are viewable"
        ON public.%1$I FOR SELECT
        TO anon, authenticated
        USING (EXISTS (
          SELECT 1 FROM public.travel_packages tp
          WHERE tp.package_id = %1$I.package_id
        ));
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "Owners and admins manage rows of own packages"
        ON public.%1$I FOR ALL
        TO authenticated
        USING (EXISTS (
          SELECT 1 FROM public.travel_packages tp
          WHERE tp.package_id = %1$I.package_id
            AND (tp.creator_id = auth.uid() OR public.is_admin())
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM public.travel_packages tp
          WHERE tp.package_id = %1$I.package_id
            AND (tp.creator_id = auth.uid() OR public.is_admin())
        ));
    $f$, t);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────
-- 8. ai_suggestions — creator-internal (prompts, AI payloads);
--    readable and writable only by the package owner or an admin
-- ─────────────────────────────────────────────
CREATE POLICY "Owners and admins view AI suggestions"
  ON public.ai_suggestions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id = ai_suggestions.package_id
      AND (tp.creator_id = auth.uid() OR public.is_admin())
  ));

CREATE POLICY "Owners and admins manage AI suggestions"
  ON public.ai_suggestions FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id = ai_suggestions.package_id
      AND (tp.creator_id = auth.uid() OR public.is_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id = ai_suggestions.package_id
      AND (tp.creator_id = auth.uid() OR public.is_admin())
  ));

-- ─────────────────────────────────────────────
-- 9. package_reviews — public read, customers insert their own.
--    No UPDATE/DELETE policies: reviews are immutable via the API.
-- ─────────────────────────────────────────────
CREATE POLICY "Reviews are viewable by everyone"
  ON public.package_reviews FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Customers insert own reviews"
  ON public.package_reviews FOR INSERT
  TO authenticated
  WITH CHECK (customer_id = auth.uid());

-- ─────────────────────────────────────────────
-- 10. package_approvals — admin-only audit log
-- ─────────────────────────────────────────────
CREATE POLICY "Admins insert approvals"
  ON public.package_approvals FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND admin_id = auth.uid());

CREATE POLICY "Admins view approvals"
  ON public.package_approvals FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────
-- 11. influencer_profiles — public read, owners manage their own
-- ─────────────────────────────────────────────
CREATE POLICY "Influencer profiles are viewable by everyone"
  ON public.influencer_profiles FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "Owners manage own influencer profile"
  ON public.influencer_profiles FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
