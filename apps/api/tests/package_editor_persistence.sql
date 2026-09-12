-- ============================================================
-- Deployment verification for supabase/migrations/0013_package_editor_persistence.sql
--
-- NOT EXECUTED by this task — no test database is available (the plan
-- forbids `supabase db push`, applying SQL to a remote DB, or starting a
-- local Supabase stack). Run this by hand, verbatim, against a disposable
-- database (or inside `BEGIN; ... ROLLBACK;` on a real one, as written)
-- after applying 0001..0013 in order, before this feature ships.
--
-- Everything runs inside one transaction that is rolled back at the end,
-- so it leaves no trace regardless of pass/fail.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────
-- Fixtures: two creators, two packages, shared catalog rows, one
-- package-owned photo, one photo that belongs to the OTHER package
-- (used as the "foreign photo" negative case).
-- ─────────────────────────────────────────────
-- profiles.id FK-references auth.users(id); seed the auth rows first.
-- Several auth.users columns (confirmation_token, recovery_token,
-- email_change, email_change_token_new) are NOT NULL with no DEFAULT on
-- some Supabase auth-schema versions, so they are seeded with '' here —
-- a known gotcha for hand-written auth.users inserts, not covered by any
-- migration in this repo (the auth schema is Supabase-managed).
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at
) VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'creator-one@example.com', 'x', now(),
   '', '', '', '', '{}'::jsonb, '{}'::jsonb, false, now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'creator-two@example.com', 'x', now(),
   '', '', '', '', '{}'::jsonb, '{}'::jsonb, false, now(), now());

INSERT INTO public.profiles (id, full_name, role)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Creator One', 'influencer'),
  ('22222222-2222-2222-2222-222222222222', 'Creator Two', 'influencer');

INSERT INTO public.flights (flight_id, airline, origin, destination, departure_datetime, arrival_datetime, price_aud)
VALUES ('cat-f1', 'QF', 'SYD', 'HND', '2026-03-01T09:00:00+00:00', '2026-03-01T18:00:00+00:00', 1200);

INSERT INTO public.travel_packages
  (package_id, creator_id, title, description, destination_country, destination_city,
   duration_days, base_price_aud, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Package A', 'desc', 'Japan', 'Tokyo', 7, 2000, 'draft'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Package B', 'desc', 'Japan', 'Osaka', 5, 1500, 'draft');

-- Package A owns this photo; package B owns the "foreign" one.
INSERT INTO public.package_media (media_id, package_id, uploaded_by, media_type, url)
VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'image', 'https://img/a.jpg'),
  ('dddddddd-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222', 'image', 'https://img/b.jpg');

-- Package A also gets one legacy junction row against the shared catalog
-- flight, to prove legacy rows (details IS NULL) are left alone by saves
-- that don't touch flights.
INSERT INTO public.package_flights (id, package_id, flight_id, sequence_order)
VALUES ('eeeeeeee-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001', 'cat-f1', 1);

-- ─────────────────────────────────────────────
-- Test 1: replace flights + hotels + activities on package A using
-- package A's own photo. Verifies the collection-replace/[]/omit
-- contract and that hotel effective nights prefer concrete dates over
-- relative days when both are supplied on the same stay.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object(
    'flights', jsonb_build_array(jsonb_build_object(
      'origin_iata', 'SYD', 'destination_iata', 'HND', 'airline', 'QF',
      'departure_datetime', '2026-03-01T09:00:00+00:00',
      'arrival_datetime', '2026-03-01T18:00:00+00:00',
      'day_number', 1, 'sequence_order', 1, 'media_ids', jsonb_build_array('cccccccc-0000-0000-0000-00000000000a')
    )),
    'hotels', jsonb_build_array(jsonb_build_object(
      'hotel_name', 'Shibuya Inn', 'city', 'Tokyo',
      'check_in_date', '2026-03-01', 'check_out_date', '2026-03-04',
      'check_in_day', 1, 'check_out_day', 8, -- deliberately inconsistent with the dates
      'price_per_night_aud', 200
    )),
    'activities', jsonb_build_array(jsonb_build_object(
      'activity_name', 'Ramen tour', 'city', 'Tokyo', 'day_number', 2, 'sequence_order', 1
    ))
  )
);

-- Flights collection replaced (legacy catalog-linked row is gone).
SELECT
  (SELECT count(*) FROM public.package_flights WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001') AS flight_rows,
  (SELECT count(*) FROM public.package_flights WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND flight_id = 'cat-f1') AS legacy_row_gone;
-- Expect flight_rows = 1, legacy_row_gone = 0.

-- Hotel effective nights: concrete dates (3 nights) win over the
-- inconsistent relative days (which would imply 7 nights).
SELECT nights FROM public.package_hotels WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect nights = 3.

-- The shared catalog flight row itself must be untouched (no duplicate
-- inventory rows, no accidental delete of shared inventory).
SELECT count(*) FROM public.flights WHERE flight_id = 'cat-f1';
-- Expect 1.

-- Package B (the second creator's package) is completely unaffected.
SELECT count(*) FROM public.package_flights WHERE package_id = 'bbbbbbbb-0000-0000-0000-000000000002';
-- Expect 0 (package B never had flights).
SELECT title, status FROM public.travel_packages WHERE package_id = 'bbbbbbbb-0000-0000-0000-000000000002';
-- Expect ('Package B', 'draft') — untouched by A's save.

-- ─────────────────────────────────────────────
-- Test 2: [] deliberately clears activities; omitting hotels/flights
-- leaves them unchanged.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('activities', jsonb_build_array())
);
SELECT count(*) FROM public.package_activities WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect 0 (cleared).
SELECT count(*) FROM public.package_flights WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect 1 (omitted flights key left it alone).

-- ─────────────────────────────────────────────
-- Test 3: exact day-number replacement for package_days, not
-- length-based trimming. Seed days 1, 2, 4; resupply {2, 5}; expect
-- {2, 5} to survive and 1, 4 to be gone (a length-trim bug would only
-- delete rows past index len(supplied), incorrectly keeping day 4).
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('days', jsonb_build_array(
    jsonb_build_object('day_number', 1, 'title', 'One'),
    jsonb_build_object('day_number', 2, 'title', 'Two'),
    jsonb_build_object('day_number', 4, 'title', 'Four')
  ))
);
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('days', jsonb_build_array(
    jsonb_build_object('day_number', 2, 'title', 'Two updated'),
    jsonb_build_object('day_number', 5, 'title', 'Five')
  ))
);
SELECT array_agg(day_number ORDER BY day_number) FROM public.package_days WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect {2,5}.

-- ─────────────────────────────────────────────
-- Test 4: foreign media is rejected with 422-equivalent outcome; the
-- package-owned photo is accepted. The SAME call also tries to shrink
-- duration_days and change the title — reproducing the reviewed critical
-- scenario (expected failures must occur before writes): if metadata
-- were written before this precondition check, title/duration_days would
-- have committed even though the call as a whole is rejected.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object(
    'title', 'Should not stick either',
    'duration_days', 2,
    'days', jsonb_build_array(
      jsonb_build_object('day_number', 1, 'media_ids', jsonb_build_array('dddddddd-0000-0000-0000-00000000000b'))
    )
  )
);
-- Expect {"outcome": "precondition_failed", "details": {"failures": [...media_ids...]}}.
-- Neither the day rows from Test 3 nor the metadata must be touched by
-- the rejected call:
SELECT array_agg(day_number ORDER BY day_number) FROM public.package_days WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect {2,5} still (unchanged — validation ran before any write).
SELECT title, duration_days FROM public.travel_packages WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect ('Package A', 7) — NOT ('Should not stick either', 2). A version
-- of the function that updated metadata before checking media ownership
-- would fail this assertion even though it reports precondition_failed.

-- ─────────────────────────────────────────────
-- Test 4b: the same "no write before validation" claim, exercised on the
-- CREATE path (p_package_id NULL) rather than update — this is the exact
-- reviewed scenario: an out-of-range flight on a fresh package must not
-- leave an orphan draft row behind.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  jsonb_build_object(
    'title', 'Should never be created', 'description', 'x',
    'destination_country', 'Japan', 'destination_city', 'Tokyo',
    'duration_days', 3, 'base_price_aud', 1000, 'tags', jsonb_build_array(),
    'flights', jsonb_build_array(jsonb_build_object(
      'origin_iata', 'SYD', 'destination_iata', 'HND', 'airline', 'QF',
      'departure_datetime', '2026-03-01T09:00:00+00:00',
      'arrival_datetime', '2026-03-01T18:00:00+00:00',
      'day_number', 9 -- out of range: duration_days is 3
    )),
    'hotels', jsonb_build_array(), 'activities', jsonb_build_array(), 'days', jsonb_build_array()
  )
);
-- Expect {"outcome": "precondition_failed", ...}.
SELECT count(*) FROM public.travel_packages WHERE title = 'Should never be created';
-- Expect 0 — no orphan draft package.

-- ─────────────────────────────────────────────
-- Test 5: ownership mismatch is reported as not_found, not not_editable
-- or a permission error.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('title', 'Hijack attempt', 'duration_days', 1)
);
-- Expect {"outcome": "not_found"}.
SELECT title, duration_days FROM public.travel_packages WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect ('Package A', 7) (unchanged).

-- ─────────────────────────────────────────────
-- Test 6: rollback after an intentionally failing late write. Run the
-- whole scenario in its own subtransaction so the forced error doesn't
-- kill the outer BEGIN...ROLLBACK harness, then confirm nothing from the
-- failing call is visible.
-- ─────────────────────────────────────────────
SAVEPOINT before_forced_failure;
DO $$
BEGIN
  -- day_number 999 has no matching catalog meaning, but more importantly:
  -- duration_days is 7, so 999 is out of range for flights AND this also
  -- exercises the final-state bound check to prove failures roll back
  -- the whole function call (flights would otherwise have been replaced
  -- before this failed).
  PERFORM public.save_package_details(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    jsonb_build_object('flights', jsonb_build_array(jsonb_build_object(
      'origin_iata', 'SYD', 'destination_iata', 'HND', 'airline', 'QF',
      'departure_datetime', '2026-03-01T09:00:00+00:00',
      'arrival_datetime', '2026-03-01T18:00:00+00:00',
      'day_number', 999
    )))
  );
END $$;
-- (This is a precondition_failed outcome, not a raised exception, so no
-- rollback is needed here — but it proves flights were left alone.)
SELECT count(*) FROM public.package_flights WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect 1 (the Test 1 flight, untouched by the rejected day_number=999 save).

-- Now force an actual exception AFTER the metadata write has already run
-- inside the same function call: day_number 3 passes bound validation (an
-- integer, in range), but activity_date is an unparseable string — that
-- cast only happens in the INSERT, which runs after the metadata UPDATE.
-- This proves a raised error rolls back a write that already happened
-- earlier in the same function call, not just writes not yet attempted.
SAVEPOINT before_exception;
DO $$
BEGIN
  PERFORM public.save_package_details(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    jsonb_build_object(
      'title', 'Should not stick',
      'activities', jsonb_build_array(jsonb_build_object(
        'activity_name', 'Bad', 'city', 'Tokyo', 'day_number', 3,
        'activity_date', 'not-a-date'
      ))
    )
  );
END $$;
ROLLBACK TO before_exception;
SELECT title FROM public.travel_packages WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect 'Package A' — the metadata UPDATE inside the same function call
-- rolled back along with the failed activities INSERT, even though the
-- UPDATE itself ran (and would otherwise have committed) before the bad
-- cast was reached.

-- ─────────────────────────────────────────────
-- Test 7: hotel relative-day bounds are checked per-field, independently
-- — a stay with only check_in_day set (no check_out_day) must not escape
-- validation just because the old combined-AND check would have skipped it.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('hotels', jsonb_build_array(jsonb_build_object(
    'hotel_name', 'Lone Day Inn', 'city', 'Tokyo', 'check_in_day', 99
  )))
);
-- Expect {"outcome": "precondition_failed", ...} — check_in_day alone
-- (99, out of range, and check_out_day missing) must be rejected, not
-- silently accepted because the pair isn't both present.
SELECT count(*) FROM public.package_hotels WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND hotel_name = 'Lone Day Inn';
-- Expect 0 — rejected, never written.

-- ─────────────────────────────────────────────
-- Test 7b (Task D): submit_package_for_review counts component ROWS, not
-- non-null catalog FKs — a custom component with NULL flight_id/hotel_id/
-- activity_id must still count toward the "at least one of each" check.
-- Single-session, no concurrency needed (that's Check A/B further below).
--
-- Package A already has 1 flight row and 1 hotel row from earlier tests
-- (unaffected by Test 7's rejected hotel save) and 0 activities (cleared
-- in Test 2). Insert ONE activity row directly with activity_id = NULL —
-- a custom, non-catalog component — and confirm submit still succeeds
-- instead of reporting a missing activity.
-- ─────────────────────────────────────────────
INSERT INTO public.package_activities (id, package_id, activity_id, day_number, details)
VALUES (
  'a7000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  NULL, 1, jsonb_build_object('activity_name', 'Custom walking tour', 'city', 'Tokyo')
);
SELECT count(*) FROM public.package_activities
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND activity_id IS NULL;
-- Expect 1 — the custom row exists with a NULL catalog FK.

SELECT public.submit_package_for_review(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'ready for review'
);
-- Expect {"outcome": "ok", "package_id": "aaaaaaaa-0000-0000-0000-000000000001"} —
-- a version of the function that counted non-null activity_id instead of
-- rows would wrongly report "missing: [activity]" here and fail this
-- assertion.
SELECT status, submitted_at, submission_note FROM public.travel_packages
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Expect status = 'pending_review', submitted_at set, submission_note =
-- 'ready for review'.

-- Reset package A back to 'draft' so the remaining tests below (which
-- assume an editable package) are unaffected by this submit.
UPDATE public.travel_packages SET status = 'draft', submitted_at = NULL, submission_note = NULL
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ─────────────────────────────────────────────
-- Test 8 (Task C): media-deletion trigger — reference cleanup.
--
-- Save a custom flight/hotel/activity plus a day, all referencing package
-- A's own photo, then delete that photo. Every association must lose the
-- reference in the same transaction as the delete; no dangling media_id
-- may remain anywhere.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object(
    'flights', jsonb_build_array(jsonb_build_object(
      'origin_iata', 'SYD', 'destination_iata', 'HND', 'airline', 'QF',
      'departure_datetime', '2026-03-01T09:00:00+00:00',
      'arrival_datetime', '2026-03-01T18:00:00+00:00',
      'media_ids', jsonb_build_array('cccccccc-0000-0000-0000-00000000000a')
    )),
    'hotels', jsonb_build_array(jsonb_build_object(
      'hotel_name', 'Shibuya Inn', 'city', 'Tokyo',
      'check_in_date', '2026-03-01', 'check_out_date', '2026-03-04',
      'media_ids', jsonb_build_array('cccccccc-0000-0000-0000-00000000000a')
    )),
    'activities', jsonb_build_array(jsonb_build_object(
      'activity_name', 'Ramen tour', 'city', 'Tokyo', 'day_number', 1,
      'media_ids', jsonb_build_array('cccccccc-0000-0000-0000-00000000000a')
    )),
    'days', jsonb_build_array(jsonb_build_object(
      'day_number', 1, 'media_ids', jsonb_build_array('cccccccc-0000-0000-0000-00000000000a')
    ))
  )
);

DELETE FROM public.package_media WHERE media_id = 'cccccccc-0000-0000-0000-00000000000a';

SELECT count(*) FROM public.package_flights
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND details->'media_ids' @> to_jsonb('cccccccc-0000-0000-0000-00000000000a'::text);
-- Expect 0 — reference removed from flight details.

SELECT count(*) FROM public.package_hotels
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND details->'media_ids' @> to_jsonb('cccccccc-0000-0000-0000-00000000000a'::text);
-- Expect 0 — reference removed from hotel details.

SELECT count(*) FROM public.package_activities
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND details->'media_ids' @> to_jsonb('cccccccc-0000-0000-0000-00000000000a'::text);
-- Expect 0 — reference removed from activity details.

SELECT media_ids FROM public.package_days
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND day_number = 1;
-- Expect '{}' — reference removed from the day's media_ids array.

SELECT count(*) FROM public.package_media WHERE media_id = 'cccccccc-0000-0000-0000-00000000000a';
-- Expect 0 — the photo row itself is gone.

-- ─────────────────────────────────────────────
-- Test 9 (Task C): a media_id belonging to another package cannot be saved
-- against this one — save_package_details' media-ownership precondition
-- check (not the delete trigger) is what rejects this.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('days', jsonb_build_array(jsonb_build_object(
    'day_number', 1, 'media_ids', jsonb_build_array('dddddddd-0000-0000-0000-00000000000b')
  )))
);
-- Expect {"outcome": "precondition_failed", "details": {"failures": [...media_ids...]}}
-- — 'dddddddd-...-b' belongs to package B, not package A.
SELECT media_ids FROM public.package_days
  WHERE package_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND day_number = 1;
-- Expect '{}' still (unchanged — the cross-package reference was never written).

-- ─────────────────────────────────────────────
-- Test 10 (Task C): the delete trigger rejects deleting a photo once the
-- package is no longer editable — the known concurrent-submit race the API
-- (app/media/service.py) maps to 409 PACKAGE_NOT_EDITABLE.
-- ─────────────────────────────────────────────
UPDATE public.travel_packages SET status = 'pending_review'
  WHERE package_id = 'bbbbbbbb-0000-0000-0000-000000000002';

SAVEPOINT before_not_editable_delete;
DO $$
BEGIN
  DELETE FROM public.package_media WHERE media_id = 'dddddddd-0000-0000-0000-00000000000b';
END $$;
-- Expect: raises "PACKAGE_NOT_EDITABLE: ...". If this SELECT is reached
-- without an exception above, the trigger failed to enforce the guard.
ROLLBACK TO before_not_editable_delete;
SELECT count(*) FROM public.package_media WHERE media_id = 'dddddddd-0000-0000-0000-00000000000b';
-- Expect 1 — delete was rejected, not merely rolled back after succeeding.

-- ─────────────────────────────────────────────
-- Test 11 (Fix A): {"tags": null} is a JSONB null, not a missing key —
-- must be gracefully ignored (ELSE arm), not crash trying to
-- jsonb_array_elements_text a scalar.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('tags', 'null'::jsonb)
);
-- Expect {"outcome": "ok", ...} — no crash; tags left unchanged.

-- ─────────────────────────────────────────────
-- Test 12 (Fix D): {"flights": null} must not error when extracting
-- media_ids from the (now v_flights-derived) flights collection — the
-- stored fallback rows are used instead of the raw JSON null.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object('flights', 'null'::jsonb)
);
-- Expect {"outcome": "ok", ...} — no crash; flights left unchanged.

-- ─────────────────────────────────────────────
-- Fixture for Tests 13-14 (Fix B): a legacy package with NULL
-- duration_days, predating the column being backfilled.
-- ─────────────────────────────────────────────
INSERT INTO public.travel_packages
  (package_id, creator_id, title, description, destination_country, destination_city,
   duration_days, base_price_aud, status)
VALUES
  ('cccccccc-1111-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Legacy Package', 'desc', 'Japan', 'Tokyo', NULL, 1000, 'draft');

-- ─────────────────────────────────────────────
-- Test 13 (Fix B): a NULL duration_days package with an out-of-range
-- day_number must be rejected, not silently accepted (NULL comparisons
-- in the bound checks would otherwise let any day_number through).
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'cccccccc-1111-0000-0000-000000000003'::uuid,
  jsonb_build_object('activities', jsonb_build_array(jsonb_build_object(
    'activity_name', 'Should be rejected', 'city', 'Tokyo', 'day_number', 9999
  )))
);
-- Expect {"outcome": "precondition_failed", "details": {"failures":
--   ["duration_days must be set before saving relative day placements"]}}.
SELECT count(*) FROM public.package_activities
  WHERE package_id = 'cccccccc-1111-0000-0000-000000000003';
-- Expect 0 — rejected, never written.

-- ─────────────────────────────────────────────
-- Test 14 (Fix B): the same NULL duration_days package must still be able
-- to save metadata only, with no relative placement supplied — the guard
-- must not block saves it has no business blocking.
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  'cccccccc-1111-0000-0000-000000000003'::uuid,
  jsonb_build_object('title', 'Legacy Package Updated')
);
-- Expect {"outcome": "ok", ...}.
SELECT title, duration_days FROM public.travel_packages
  WHERE package_id = 'cccccccc-1111-0000-0000-000000000003';
-- Expect ('Legacy Package Updated', NULL).

-- ─────────────────────────────────────────────
-- Test 15 (Fix E3): create with media_ids gets the distinct create-time
-- failure message, not the "already uploaded to this package" message
-- (which implies a package that already exists).
-- ─────────────────────────────────────────────
SELECT public.save_package_details(
  '11111111-1111-1111-1111-111111111111'::uuid,
  NULL,
  jsonb_build_object(
    'title', 'Should never be created', 'description', 'x',
    'destination_country', 'Japan', 'destination_city', 'Tokyo',
    'duration_days', 3, 'base_price_aud', 1000, 'tags', jsonb_build_array(),
    'flights', jsonb_build_array(), 'hotels', jsonb_build_array(),
    'activities', jsonb_build_array(),
    'days', jsonb_build_array(jsonb_build_object(
      'day_number', 1, 'media_ids', jsonb_build_array('cccccccc-0000-0000-0000-00000000000a')
    ))
  )
);
-- Expect {"outcome": "precondition_failed", "details": {"failures":
--   ["media_ids cannot be set on create — upload media after the package exists"]}}.
SELECT count(*) FROM public.travel_packages WHERE title = 'Should never be created';
-- Expect 0 — no orphan draft package.

ROLLBACK;

-- ============================================================
-- Task D: two-connection concurrency checks for submit_package_for_review.
--
-- NOT EXECUTED by this task — same constraint as above (no test database
-- available). These checks need two SEPARATE physical connections (two
-- psql sessions, or two connections from a client) because they prove a
-- real row lock blocks a concurrent transaction — a single-session,
-- single-transaction script (like the harness above) cannot exercise
-- that: nothing would ever actually block.
--
-- Run against a disposable database with 0001..0013 already applied.
-- Each step is marked with which connection runs it. Run steps strictly
-- in the printed order; where a step is marked "(blocks)", the session
-- issuing it will hang until the OTHER session's next step releases the
-- lock — that hang is itself the thing being verified.
-- ============================================================

-- ── Setup (either connection) ──────────────────────────────────────────
-- BEGIN;
-- INSERT INTO auth.users (
--   id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
--   confirmation_token, recovery_token, email_change, email_change_token_new,
--   raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at
-- ) VALUES (
--   '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
--   'authenticated', 'authenticated', 'creator-three@example.com', 'x', now(),
--   '', '', '', '', '{}'::jsonb, '{}'::jsonb, false, now(), now()
-- );
-- INSERT INTO public.profiles (id, full_name, role)
-- VALUES ('33333333-3333-3333-3333-333333333333', 'Creator Three', 'influencer');
-- INSERT INTO public.travel_packages
--   (package_id, creator_id, title, description, destination_country, destination_city,
--    duration_days, base_price_aud, status)
-- VALUES
--   ('ffffffff-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
--    'Package D1', 'desc', 'Japan', 'Kyoto', 5, 1000, 'draft'),
--   ('ffffffff-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
--    'Package D2', 'desc', 'Japan', 'Nara', 5, 1000, 'draft');
-- SELECT public.save_package_details(
--   '33333333-3333-3333-3333-333333333333'::uuid, 'ffffffff-0000-0000-0000-000000000001'::uuid,
--   jsonb_build_object(
--     'flights', jsonb_build_array(jsonb_build_object(
--       'origin_iata', 'SYD', 'destination_iata', 'KIX', 'airline', 'QF',
--       'departure_datetime', '2026-03-01T09:00:00+00:00', 'arrival_datetime', '2026-03-01T18:00:00+00:00',
--       'day_number', 1
--     )),
--     'hotels', jsonb_build_array(jsonb_build_object('hotel_name', 'Kyoto Inn', 'city', 'Kyoto', 'check_in_day', 1, 'check_out_day', 3)),
--     'activities', jsonb_build_array(jsonb_build_object('activity_name', 'Temple walk', 'city', 'Kyoto', 'day_number', 1))
--   )
-- );
-- SELECT public.save_package_details(
--   '33333333-3333-3333-3333-333333333333'::uuid, 'ffffffff-0000-0000-0000-000000000002'::uuid,
--   jsonb_build_object(
--     'flights', jsonb_build_array(jsonb_build_object(
--       'origin_iata', 'SYD', 'destination_iata', 'KIX', 'airline', 'QF',
--       'departure_datetime', '2026-03-01T09:00:00+00:00', 'arrival_datetime', '2026-03-01T18:00:00+00:00',
--       'day_number', 1
--     )),
--     'hotels', jsonb_build_array(jsonb_build_object('hotel_name', 'Nara Inn', 'city', 'Nara', 'check_in_day', 1, 'check_out_day', 3)),
--     'activities', jsonb_build_array(jsonb_build_object('activity_name', 'Deer park', 'city', 'Nara', 'day_number', 1))
--   )
-- );
-- COMMIT;

-- ── Check A: save-holds-lock-first blocks a concurrent submit, and submit
--    re-reads the now-changed state after the lock is released (not stale
--    data read before the save committed).
--    Uses Package D1 (ffffffff-...-0000000001).
-- ────────────────────────────────────────────────────────────────────────
-- Connection 1                                | Connection 2
-- ---------------------------------------------|---------------------------------------------
-- BEGIN;                                       |
-- -- Clear activities but do not commit yet —  |
-- -- this must acquire and hold the row lock   |
-- -- before submit can read anything.          |
-- SELECT public.save_package_details(          |
--   '33333333-3333-3333-3333-333333333333'::uuid,|
--   'ffffffff-0000-0000-0000-000000000001'::uuid,|
--   jsonb_build_object('activities', jsonb_build_array())|
-- );                                            |
--                                               | BEGIN;
--                                               | -- (blocks) waits for Connection 1's row lock.
--                                               | SELECT public.submit_package_for_review(
--                                               |   '33333333-3333-3333-3333-333333333333'::uuid,
--                                               |   'ffffffff-0000-0000-0000-000000000001'::uuid,
--                                               |   'please review'
--                                               | );
-- COMMIT;  -- releases the lock; Connection 2's |
--          -- submit now proceeds.             |
--                                               | -- Expect: {"outcome": "precondition_failed",
--                                               | --   "details": {"failures": [...activity...],
--                                               | --   "missing": ["activity"]}} — submit saw the
--                                               | --   CLEARED activities, proving it re-read
--                                               | --   component state after acquiring the lock
--                                               | --   Connection 1 held, not a snapshot taken
--                                               | --   before the save committed.
--                                               | COMMIT;

-- ── Check B: reverse the order — submit commits pending_review first;
--    the later save must be rejected as not_editable, not race past it.
--    Uses Package D2 (ffffffff-...-0000000002).
-- ────────────────────────────────────────────────────────────────────────
-- Connection 1                                  | Connection 2
-- -----------------------------------------------|---------------------------------------------
-- BEGIN;                                         |
-- -- Hold the row lock while submit runs, before |
-- -- Connection 2's save can be attempted.       |
-- SELECT public.submit_package_for_review(       |
--   '33333333-3333-3333-3333-333333333333'::uuid,|
--   'ffffffff-0000-0000-0000-000000000002'::uuid,|
--   'please review'                              |
-- );                                              |
-- -- Expect {"outcome": "ok", "package_id": ...}  |
--                                                 | BEGIN;
--                                                 | -- (blocks) waits for Connection 1's row lock.
--                                                 | SELECT public.save_package_details(
--                                                 |   '33333333-3333-3333-3333-333333333333'::uuid,
--                                                 |   'ffffffff-0000-0000-0000-000000000002'::uuid,
--                                                 |   jsonb_build_object('title', 'Edit after submit')
--                                                 | );
-- COMMIT;  -- releases the lock; status is now    |
--          -- pending_review when Connection 2's  |
--          -- save proceeds.                      |
--                                                 | -- Expect: {"outcome": "not_editable",
--                                                 | --   "status": "pending_review"} — the save
--                                                 | --   re-checked status AFTER acquiring the lock
--                                                 | --   Connection 1 held, so it saw the committed
--                                                 | --   pending_review, not a stale draft read
--                                                 | --   before Connection 1's submit committed.
--                                                 | COMMIT;

-- ── Teardown (either connection) ────────────────────────────────────────
-- BEGIN;
-- DELETE FROM public.travel_packages WHERE package_id IN (
--   'ffffffff-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000002');
-- DELETE FROM public.profiles WHERE id = '33333333-3333-3333-3333-333333333333';
-- DELETE FROM auth.users WHERE id = '33333333-3333-3333-3333-333333333333';
-- COMMIT;
