-- ============================================================
-- Detail-page fields (DEV-40): package tags/group size, media
-- sort order, media_type 'photo' -> 'image' (openapi.yaml enum),
-- and per-day itinerary narrative (package_days).
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. travel_packages — detail-page fields
-- ─────────────────────────────────────────────
ALTER TABLE public.travel_packages
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN max_group_size INT;

-- ─────────────────────────────────────────────
-- 2. package_media — sort order + 'photo' -> 'image'.
--    Drop the CHECK before the UPDATE: the new value violates
--    the old constraint.
-- ─────────────────────────────────────────────
ALTER TABLE public.package_media
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

ALTER TABLE public.package_media
  DROP CONSTRAINT package_media_media_type_check;

UPDATE public.package_media
  SET media_type = 'image'
  WHERE media_type = 'photo';

ALTER TABLE public.package_media
  ADD CONSTRAINT package_media_media_type_check
  CHECK (media_type IN ('image', 'video'));

-- ─────────────────────────────────────────────
-- 3. package_days — per-day narrative for detail-page rendering
-- ─────────────────────────────────────────────
CREATE TABLE public.package_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.travel_packages (package_id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  title TEXT,
  summary TEXT,
  UNIQUE (package_id, day_number)
);

CREATE INDEX idx_package_days_package ON public.package_days (package_id);

-- RLS: same child-table policies as 0003 §7 — visibility and
-- ownership follow the parent package via travel_packages' RLS.
ALTER TABLE public.package_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rows of visible packages are viewable"
  ON public.package_days FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id = package_days.package_id
  ));

CREATE POLICY "Owners and admins manage rows of own packages"
  ON public.package_days FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id = package_days.package_id
      AND (tp.creator_id = auth.uid() OR public.is_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id = package_days.package_id
      AND (tp.creator_id = auth.uid() OR public.is_admin())
  ));

NOTIFY pgrst, 'reload schema';
