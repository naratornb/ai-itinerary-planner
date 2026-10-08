-- Run after all migrations in a disposable PostgreSQL database.
-- psql -v ON_ERROR_STOP=1 -f apps/api/tests/local_travel_packages.sql
BEGIN;
SET LOCAL plpgsql.check_asserts = on;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-1111-1111-111111111111', 'local-creator@example.com', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'other-creator@example.com', '{}');
UPDATE public.profiles SET role = 'influencer'
WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.travel_packages
  (package_id, creator_id, title, duration_days, base_price_aud)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Local weekend', 2, 500);
-- Custom components count even when their catalog foreign keys are null.
INSERT INTO public.package_hotels (package_id, details)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '{"hotel_name":"Local inn"}');
INSERT INTO public.package_activities (package_id, details)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '{"activity_name":"Walking tour"}');

DO $$
DECLARE
  actor UUID := '11111111-1111-1111-1111-111111111111';
  pkg UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  result JSONB;
  package_status TEXT;
BEGIN
  FOREACH package_status IN ARRAY ARRAY['draft', 'rejected'] LOOP
    UPDATE public.travel_packages SET status = package_status WHERE package_id = pkg;
    result := public.submit_package_for_review(actor, pkg, 'Ready locally');
    ASSERT result->>'outcome' = 'ok', format('Flightless %s rejected: %s', package_status, result);
    ASSERT (SELECT status = 'pending_review' AND submitted_at IS NOT NULL
                   AND submission_note = 'Ready locally'
            FROM public.travel_packages WHERE package_id = pkg), 'Submission state was not saved';
    ASSERT NOT EXISTS (SELECT 1 FROM public.package_flights WHERE package_id = pkg), 'Submission added a flight';
  END LOOP;

  FOREACH package_status IN ARRAY ARRAY['pending_review', 'approved', 'live', 'archived'] LOOP
    UPDATE public.travel_packages SET status = package_status WHERE package_id = pkg;
    result := public.submit_package_for_review(actor, pkg, 'Must not overwrite');
    ASSERT result->>'outcome' = 'precondition_failed', 'Invalid status accepted';
    ASSERT result->'details'->'missing' = '[]'::jsonb, 'Flights reported as missing';
    ASSERT (SELECT status = package_status AND submission_note = 'Ready locally'
            FROM public.travel_packages WHERE package_id = pkg), 'Failed submission changed state';
  END LOOP;

  UPDATE public.travel_packages SET status = 'draft', base_price_aud = 0 WHERE package_id = pkg;
  result := public.submit_package_for_review(actor, pkg, NULL);
  ASSERT result->>'outcome' = 'precondition_failed', 'Zero price accepted';
  ASSERT result->'details'->'failures' @> '["base_price_aud must be greater than 0."]'::jsonb;
  ASSERT result->'details'->'missing' = '[]'::jsonb;
  UPDATE public.travel_packages SET base_price_aud = 500 WHERE package_id = pkg;

  DELETE FROM public.package_hotels WHERE package_id = pkg;
  result := public.submit_package_for_review(actor, pkg, NULL);
  ASSERT result->'details'->'missing' = '["hotel"]'::jsonb, 'Hotel requirement lost';
  INSERT INTO public.package_hotels (package_id, details) VALUES (pkg, '{}');
  DELETE FROM public.package_activities WHERE package_id = pkg;
  result := public.submit_package_for_review(actor, pkg, NULL);
  ASSERT result->'details'->'missing' = '["activity"]'::jsonb, 'Activity requirement lost';
  DELETE FROM public.package_hotels WHERE package_id = pkg;
  result := public.submit_package_for_review(actor, pkg, NULL);
  ASSERT result->'details'->'missing' = '["hotel", "activity"]'::jsonb;
  ASSERT (SELECT status = 'draft' AND submission_note = 'Ready locally'
          FROM public.travel_packages WHERE package_id = pkg), 'Failed preconditions changed state';

  result := public.submit_package_for_review('22222222-2222-2222-2222-222222222222', pkg, NULL);
  ASSERT result->>'outcome' = 'not_found', 'Another creator can submit the package';
  ASSERT NOT has_function_privilege('authenticated', 'public.submit_package_for_review(uuid,uuid,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.submit_package_for_review(uuid,uuid,text)', 'EXECUTE');
  ASSERT has_function_privilege('service_role', 'public.submit_package_for_review(uuid,uuid,text)', 'EXECUTE');

  INSERT INTO public.package_hotels (package_id, details) VALUES (pkg, '{}');
  INSERT INTO public.package_activities (package_id, details) VALUES (pkg, '{}');
  INSERT INTO public.package_flights (package_id, details) VALUES (pkg, '{}');
  result := public.submit_package_for_review(actor, pkg, NULL);
  ASSERT result->>'outcome' = 'ok', 'Package containing a flight regressed';
END;
$$;

ROLLBACK;
