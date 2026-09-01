-- ============================================================
-- Media storage: package_media upload metadata + the
-- 'package-media' Storage bucket and its storage.objects RLS.
-- Object paths are `{package_id}/{filename}`, so the first path
-- segment is the owning package UUID.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. package_media — original upload metadata
-- ─────────────────────────────────────────────
ALTER TABLE public.package_media
  ADD COLUMN filename TEXT,
  ADD COLUMN file_size_bytes BIGINT;

-- ─────────────────────────────────────────────
-- 2. Public bucket for package media.
--    52428800 = 50 MB, the free-plan per-file ceiling.
--    TODO:: the API contract allows 200 MB videos — raising
--    file_size_limit to that needs a paid Supabase plan.
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('package-media', 'package-media', TRUE, 52428800,
        ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 3. storage.objects policies (RLS is already enabled by Supabase).
--    Writes follow package ownership, mirroring 0003 §7.
-- ─────────────────────────────────────────────
CREATE POLICY "Package media is publicly readable"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'package-media');

CREATE POLICY "Owners upload package media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'package-media' AND EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id::text = (storage.foldername(name))[1]
      AND tp.creator_id = auth.uid()
  ));

CREATE POLICY "Owners delete package media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'package-media' AND EXISTS (
    SELECT 1 FROM public.travel_packages tp
    WHERE tp.package_id::text = (storage.foldername(name))[1]
      AND tp.creator_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';
