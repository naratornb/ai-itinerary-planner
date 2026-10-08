-- Flights are optional: zero flight components define a local travel package.
-- Keep submission atomic and restricted to the service role.
CREATE OR REPLACE FUNCTION public.submit_package_for_review(
  p_actor_id UUID,
  p_package_id UUID,
  p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_base_price_aud BIGINT;
  v_hotel_count INT;
  v_activity_count INT;
  v_missing TEXT[] := '{}';
  v_failures TEXT[] := '{}';
BEGIN
  IF p_actor_id IS NULL OR p_package_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Lock before checking status and components so save cannot race submission.
  SELECT status, base_price_aud INTO v_status, v_base_price_aud
  FROM public.travel_packages
  WHERE package_id = p_package_id AND creator_id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_status NOT IN ('draft', 'rejected') THEN
    v_failures := v_failures || format(
      'Package status is ''%s''; only ''draft'' or ''rejected'' packages may be submitted.',
      v_status
    );
  END IF;

  SELECT count(*) INTO v_hotel_count FROM public.package_hotels WHERE package_id = p_package_id;
  SELECT count(*) INTO v_activity_count FROM public.package_activities WHERE package_id = p_package_id;

  IF v_hotel_count = 0 THEN v_missing := array_append(v_missing, 'hotel'); END IF;
  IF v_activity_count = 0 THEN v_missing := array_append(v_missing, 'activity'); END IF;

  IF array_length(v_missing, 1) > 0 THEN
    v_failures := v_failures || (
      'Package must have at least one ' || array_to_string(v_missing, ', ') || '.'
    );
  END IF;

  IF COALESCE(v_base_price_aud, 0) <= 0 THEN
    v_failures := array_append(v_failures, 'base_price_aud must be greater than 0.');
  END IF;

  IF array_length(v_failures, 1) > 0 THEN
    RETURN jsonb_build_object(
      'outcome', 'precondition_failed',
      'details', jsonb_build_object(
        'failures', v_failures,
        'missing', to_jsonb(v_missing)
      )
    );
  END IF;

  UPDATE public.travel_packages SET
    status = 'pending_review',
    submitted_at = now(),
    submission_note = p_note,
    updated_at = now()
  WHERE package_id = p_package_id;

  RETURN jsonb_build_object('outcome', 'ok', 'package_id', p_package_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_package_for_review(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_package_for_review(UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
