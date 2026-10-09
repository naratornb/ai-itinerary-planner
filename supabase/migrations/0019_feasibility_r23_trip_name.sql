-- ============================================================
-- feasibility_rules: add R23 (Trip Name Match), a soft warning when the
-- trip name promises something no scheduled activity provides (e.g. a
-- "Beach & Relaxation Tour" of city museums). Matches FALLBACK_RULES in
-- apps/web/lib/feasibility.ts. Data-only; a no-op if R23 already exists.
-- ============================================================

INSERT INTO public.feasibility_rules (rule_code, rule_name, rule_description, is_active, rule_priority)
SELECT 'R23', 'Trip Name Match', 'Compare the trip name with the activities actually scheduled. Flag a SOFT WARNING only when the name promises a specific place, landscape or kind of activity that no scheduled activity provides (e.g. "Beach & Relaxation Tour" with no beach, "Island Hopping" with no island trip, "Tokyo & Kyoto" with nothing in Kyoto, "Ski Week" with no skiing). Never flag a general name or a broad theme that city activities can fit, such as culture, cultural exploration, discovery, adventure, highlights or getaway ("4-Day Cultural Exploration of Bangkok", "4 Days in Bangkok"). Use error_code "TRIP_NAME_MISMATCH", rule "R23 – Trip Name Match", and word it as: message "The trip name \"<trip name>\" promises <what it promises>, but no scheduled activity offers it.", action "Rename the trip to match its activities, or add <what it promises>."', true,
       COALESCE((SELECT max(rule_priority) FROM public.feasibility_rules), 0) + 1
ON CONFLICT (rule_code) DO NOTHING;
