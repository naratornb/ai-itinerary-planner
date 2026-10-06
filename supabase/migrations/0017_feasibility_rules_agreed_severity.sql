-- ============================================================
-- feasibility_rules: AI rule wording for the agreed requirements.
-- R3 (opening hours) and R4 (day closure) are hard errors; R12 is a
-- hard error when the gap is shorter than a realistic travel time and
-- words it as "Not enough time to get from X to Y"; R10 no longer
-- calls places in the same city too far apart. Matches FALLBACK_RULES
-- in apps/web/lib/feasibility.ts. Data-only.
-- ============================================================

UPDATE public.feasibility_rules
SET rule_description = 'Flag an activity whose scheduled time (start_time to start_time + duration_hours) falls clearly outside the venue''s usual opening hours (e.g. a shrine after dusk, a museum after it closes at 17:00–18:00, Tsukiji Outer Market stalls after 14:00–15:00). Only flag venues whose hours you are confident about. This is a HARD ERROR with error_code "OPENING_HOURS", rule "R3 – Opening Hours"; the message names the venue, the scheduled time and its usual hours, and the action suggests a time within them.',
    updated_at = now()
WHERE rule_code = 'R3';

UPDATE public.feasibility_rules
SET rule_description = 'Flag an activity at a venue that is closed on the weekday that day falls on (e.g. many Japanese museums close Mondays). Only flag it when the itinerary states a date or weekday for that day; if it doesn''t, skip this rule rather than guess. This is a HARD ERROR with error_code "DAY_CLOSURE", rule "R4 – Day Closure".',
    updated_at = now()
WHERE rule_code = 'R4';

UPDATE public.feasibility_rules
SET rule_description = 'Flag a day only when it combines an out-of-city excursion (1+ hours of one-way travel from the city centre, e.g. Mt. Fuji, Nikko or Hakone from Tokyo, Ayutthaya from Bangkok) with other activities, or has activities in different cities. Never flag activities that are all in the same city as too far apart, however spread out the city is. This is often intentional (an early start and late finish), so always classify these as a SOFT WARNING, never a hard error, with error_code "DAILY_RANGE", rule "R10 – Daily Range".',
    updated_at = now()
WHERE rule_code = 'R10';

UPDATE public.feasibility_rules
SET rule_description = 'Each activity line shows a start_time, duration_hours and address. For each consecutive pair of activities on the same day, use the gap given on the first activity''s line ("N min until the next activity" — never work it out yourself), and estimate a realistic door-to-door travel time between the two addresses by taxi or public transport (most trips within one city take 10–40 minutes; allow up to 60 minutes across a large, congested city). Flag a HARD ERROR if the gap is shorter than your estimated travel time. Do not flag pairs at the same venue, next door, or in the same neighbourhood. Use error_code "SHORT_TRANSFER_ACTIVITY", rule "R12 – Activity Transfer Time", and word it as: message "Not enough time to get from \"<first activity>\" to \"<second activity>\": <gap> min between them, but the trip takes about <estimate> min.", action "Leave at least <estimate> min between them, or swap one for something closer."',
    updated_at = now()
WHERE rule_code = 'R12';
