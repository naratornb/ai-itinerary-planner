-- ============================================================
-- Package-component fields for the influencer packages CRUD
-- endpoints (openapi.yaml v1.1.0 packages tag) — columns the
-- spec Input schemas require but the DB lacks.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Catalog tables — flights, hotels, activities
-- ─────────────────────────────────────────────
ALTER TABLE public.flights
  ADD COLUMN flight_number TEXT;

ALTER TABLE public.hotels
  ADD COLUMN address TEXT;

ALTER TABLE public.activities
  ADD COLUMN description TEXT,
  ADD COLUMN booking_required BOOLEAN;

-- ─────────────────────────────────────────────
-- 2. Package components — concrete dates.
--    Spec components carry concrete dates; the existing
--    day-int columns stay for marketplace day grouping.
-- ─────────────────────────────────────────────
ALTER TABLE public.package_hotels
  ADD COLUMN check_in_date DATE,
  ADD COLUMN check_out_date DATE;

ALTER TABLE public.package_activities
  ADD COLUMN activity_date DATE;

-- ─────────────────────────────────────────────
-- 3. travel_packages — influencer note shown to the
--    reviewing admin on submit
-- ─────────────────────────────────────────────
ALTER TABLE public.travel_packages
  ADD COLUMN submission_note TEXT;

NOTIFY pgrst, 'reload schema';
