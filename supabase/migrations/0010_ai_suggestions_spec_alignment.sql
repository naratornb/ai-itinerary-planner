-- ============================================================
-- ai_suggestions — align with the API contract's AISuggestion
-- schema (openapi.yaml). Renames prompt_context -> prompt and
-- created_at -> generated_at, swaps suggestion_content/accepted
-- for suggestion_text/status, adds accepted_at and
-- response_time_ms, drops suggestion_type (no spec counterpart).
--
-- Destructive by design: pre-launch demo rows still use the old
-- schema and their content column (suggestion_content) is dropped
-- below anyway, so they are cleared first — without this the
-- NOT NULL suggestion_text addition fails on any non-empty table.
-- Re-run supabase/seed/02_users_packages.sql to repopulate demo
-- suggestions in the new shape.
-- ============================================================

-- ─────────────────────────────────────────────
-- 0. Clear old-schema rows (unmigratable + re-seedable)
-- ─────────────────────────────────────────────
DELETE FROM public.ai_suggestions;

-- ─────────────────────────────────────────────
-- 1. Renames
-- ─────────────────────────────────────────────
ALTER TABLE public.ai_suggestions RENAME COLUMN prompt_context TO prompt;
ALTER TABLE public.ai_suggestions RENAME COLUMN created_at TO generated_at;

ALTER TABLE public.ai_suggestions
  ALTER COLUMN prompt SET NOT NULL;

-- ─────────────────────────────────────────────
-- 2. Column swaps + new spec fields
-- ─────────────────────────────────────────────
ALTER TABLE public.ai_suggestions
  DROP COLUMN suggestion_content,
  DROP COLUMN accepted,
  DROP COLUMN suggestion_type,
  ADD COLUMN suggestion_text  TEXT        NOT NULL,
  ADD COLUMN status           TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'dismissed')),
  ADD COLUMN accepted_at      TIMESTAMPTZ,
  ADD COLUMN response_time_ms INTEGER;

-- ─────────────────────────────────────────────
-- 3. RLS — nothing to recreate.
--    The 0003 §8 policies ("Owners and admins view/manage AI
--    suggestions") key off ai_suggestions.package_id ownership
--    only; none of them reference a dropped column.
-- ─────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
