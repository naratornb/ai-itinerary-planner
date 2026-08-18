-- ============================================================
-- Align public.influencer_profiles with the API contract
--
-- UserProfile.influencer_profile exposes instagram_handle and
-- tiktok_handle; the table only had a generic social_handle.
-- ============================================================

ALTER TABLE public.influencer_profiles
  RENAME COLUMN social_handle TO instagram_handle;

ALTER TABLE public.influencer_profiles
  ADD COLUMN tiktok_handle TEXT;
