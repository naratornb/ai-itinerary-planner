-- ============================================================
-- feasibility_rules: R23 (Trip Name Match) no longer compares the day
-- count in a trip name with the itinerary. "5 Day Cultural Trip to
-- Singapore" on a 5-day trip was flagged for having activities on only
-- some days; trip length and empty days are checked separately. Matches
-- FALLBACK_RULES in apps/web/lib/feasibility.ts. Data-only.
-- ============================================================

UPDATE public.feasibility_rules
SET rule_description = 'Compare the trip name with the activities actually scheduled. Flag a SOFT WARNING only when the name promises a specific place, landscape or kind of activity that no scheduled activity provides (e.g. "Beach & Relaxation Tour" with no beach, "Island Hopping" with no island trip, "Tokyo & Kyoto" with nothing in Kyoto, "Ski Week" with no skiing). Never flag a general name or a broad theme that city activities can fit, such as culture, cultural exploration, discovery, adventure, highlights or getaway ("4-Day Cultural Exploration of Bangkok", "4 Days in Bangkok"). Never compare the number of days in the name with the itinerary, or count how many days have activities: trip length and empty days are checked separately. Use error_code "TRIP_NAME_MISMATCH", rule "R23 – Trip Name Match", and word it as: message "The trip name \"<trip name>\" promises <what it promises>, but no scheduled activity offers it.", action "Rename the trip to match its activities, or add <what it promises>."',
    updated_at = now()
WHERE rule_code = 'R23';
