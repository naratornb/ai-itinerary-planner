-- ============================================================
-- feasibility_rules: R12 (Activity Transfer Time) becomes a soft
-- warning. Travel time between catalog activities is now calculated in
-- code from their coordinates (taxi: 10 min + 3 min per km), because the
-- AI estimate rose with the gap. Matches FALLBACK_RULES in
-- apps/web/lib/feasibility.ts. Data-only.
-- ============================================================

UPDATE public.feasibility_rules
SET rule_description = 'Each activity line shows a start_time, duration_hours and address. For each consecutive pair of activities on the same day, use the gap given on the first activity''s line ("N min until the next activity" — never work it out yourself), and estimate a realistic door-to-door travel time between the two addresses by taxi or public transport (most trips within one city take 10–40 minutes; allow up to 60 minutes across a large, congested city). Flag a SOFT WARNING if the gap is shorter than your estimated travel time (travel time between catalog activities is also calculated separately from their coordinates). Do not flag pairs at the same venue, next door, or in the same neighbourhood. Use error_code "SHORT_TRANSFER_ACTIVITY", rule "R12 – Activity Transfer Time", and word it as: message "Not enough time to get from \"<first activity>\" to \"<second activity>\": <gap> min between them, but the trip takes about <estimate> min.", action "Leave at least <estimate> min between them, or swap one for something closer."',
    updated_at = now()
WHERE rule_code = 'R12';
