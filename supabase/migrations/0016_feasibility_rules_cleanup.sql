-- ============================================================
-- feasibility_rules cleanup: retire AI rules that contradict or
-- duplicate the deterministic checks in apps/web/lib/feasibility.ts,
-- and bring R11 in line with the travel season the editor now sends.
-- Data-only; every statement is a no-op where the row doesn't exist.
-- ============================================================

-- "At most one activity on the first/last day" blocked ordinary
-- arrival days. Replaced by the code check R20 (Travel Day Load),
-- which warns on total hours instead of counting activities.
UPDATE public.feasibility_rules
SET is_active = false, updated_at = now()
WHERE rule_code IS NULL
  AND rule_description ILIKE 'First and last days of a package must have at most one activity%';

-- The 10-hour daily limit is already enforced by the code check R1;
-- the AI copy only produced duplicate findings.
UPDATE public.feasibility_rules
SET is_active = false, updated_at = now()
WHERE rule_code IS NULL
  AND rule_description ILIKE 'Total scheduled activity hours per day must not exceed 10%';

-- R8 judged activities against a group size the editor never collects.
UPDATE public.feasibility_rules
SET is_active = false, updated_at = now()
WHERE rule_code = 'R8';

-- R11 still referred to a travel month; the check now sends a travel season.
UPDATE public.feasibility_rules
SET rule_description = 'Flag if the stated travel season is a poor fit for the destination (e.g. a trip themed or named around a season that contradicts a separately stated travel season). Skip this rule entirely if no travel season is given.',
    updated_at = now()
WHERE rule_code = 'R11';
