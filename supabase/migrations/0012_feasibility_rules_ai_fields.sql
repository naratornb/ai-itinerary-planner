-- ============================================================
-- feasibility_rules: add rule_code + rule_name so the AI-contextual
-- rules used by the itinerary feasibility check (apps/web) can be
-- driven from this table instead of being hardcoded in the prompt.
-- ============================================================

ALTER TABLE public.feasibility_rules
  ADD COLUMN rule_code text,
  ADD COLUMN rule_name text;

ALTER TABLE public.feasibility_rules
  ADD CONSTRAINT feasibility_rules_rule_code_key UNIQUE (rule_code);
