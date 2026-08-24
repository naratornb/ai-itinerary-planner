-- ============================================================
-- Align public.package_approvals with the API contract's
-- ApprovalRecord: reviewer_id / decision / reviewed_at (the DB
-- had admin_id / action / actioned_at), plus a notes column for
-- the optional notes on ApproveRequest and RejectRequest.
-- ============================================================

ALTER TABLE public.package_approvals
  RENAME COLUMN admin_id TO reviewer_id;

ALTER TABLE public.package_approvals
  RENAME COLUMN action TO decision;

ALTER TABLE public.package_approvals
  RENAME COLUMN actioned_at TO reviewed_at;

ALTER TABLE public.package_approvals
  ADD COLUMN notes TEXT;

-- ponytail: no policy or constraint DDL needed. Postgres stores
-- policy expressions and CHECK constraints as parsed trees keyed
-- on column attnum, so RENAME COLUMN rewrites them in place. The
-- "Admins insert approvals" INSERT policy (0003) now reads
-- WITH CHECK (public.is_admin() AND reviewer_id = auth.uid()),
-- and the decision CHECK still allows 'approved' | 'rejected'.
-- Constraint name package_approvals_action_check is cosmetic —
-- rename only if it ever shows up in a user-facing error.
