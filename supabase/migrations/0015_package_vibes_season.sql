-- ============================================================
-- Vibe & season tags on travel_packages: the wizard's fixed
-- vocabularies become first-class columns, separate from the
-- free-form tags[]. save_package_details learns the two payload
-- keys (same omission/clear semantics as tags; season is a
-- scalar so an explicit null clears it, like max_group_size).
-- search_packages is untouched: the search flow re-fetches card
-- fields by id after ranking, so the new columns flow through
-- that second query.
-- ============================================================

ALTER TABLE public.travel_packages
  ADD COLUMN vibes TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT travel_packages_vibes_allowed CHECK (
      vibes <@ ARRAY['chill','adventure','luxury','local','foodie','scenic']::text[]
    ),
  ADD COLUMN season TEXT
    CONSTRAINT travel_packages_season_allowed CHECK (
      season IN ('spring','summer','autumn','winter')
    );

CREATE OR REPLACE FUNCTION public.save_package_details(
  p_actor_id UUID,
  p_package_id UUID,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_package_id UUID := p_package_id;
  v_status TEXT;
  v_duration_days INTEGER;
  v_flights JSONB;
  v_hotels JSONB;
  v_activities JSONB;
  v_days JSONB;
  v_media_ids UUID[];
  v_failures TEXT[] := '{}';
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_package_id IS NULL THEN
    -- CREATE: nothing to lock yet — duration_days is required on create,
    -- so just read it. The INSERT itself is deferred below, after
    -- validation, so a rejected create never leaves an orphan draft row.
    v_duration_days := (p_payload->>'duration_days')::INTEGER;
  ELSE
    -- UPDATE: lock the owned row before checking status or reading
    -- anything it implies (submit's fix for the same race is Task D's
    -- job; save must not leave a window between the read and the write
    -- either). No metadata/collection write happens until after
    -- validation below.
    SELECT status, duration_days INTO v_status, v_duration_days
    FROM public.travel_packages
    WHERE package_id = v_package_id AND creator_id = p_actor_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    IF v_status NOT IN ('draft', 'rejected') THEN
      RETURN jsonb_build_object('outcome', 'not_editable', 'status', v_status);
    END IF;

    IF p_payload ? 'duration_days' THEN
      v_duration_days := (p_payload->>'duration_days')::INTEGER;
    END IF;
  END IF;

  -- Final-state bound validation. Use the supplied collection when the
  -- caller resupplied it; otherwise use the currently stored rows, so a
  -- shrinking duration_days is validated against components left alone.
  -- "Supplied" means the key holds a JSON array — not merely present.
  -- {"flights": null} is a JSONB null, not SQL NULL, so a bare `? 'flights'`
  -- check would enter the "supplied" branch and then blow up extracting
  -- elements from a scalar. The HTTP path never sends null for these keys
  -- (schemas.py rejects it with 422), but this RPC has no other caller
  -- guarding it, so it must not crash if called directly with one.
  IF jsonb_typeof(p_payload->'flights') = 'array' THEN
    v_flights := p_payload->'flights';
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('day_number', day_number)), '[]'::jsonb)
      INTO v_flights FROM public.package_flights WHERE package_id = v_package_id;
  END IF;

  IF jsonb_typeof(p_payload->'activities') = 'array' THEN
    v_activities := p_payload->'activities';
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('day_number', day_number)), '[]'::jsonb)
      INTO v_activities FROM public.package_activities WHERE package_id = v_package_id;
  END IF;

  IF jsonb_typeof(p_payload->'hotels') = 'array' THEN
    v_hotels := p_payload->'hotels';
  ELSE
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('check_in_day', check_in_day, 'check_out_day', check_out_day)),
      '[]'::jsonb
    ) INTO v_hotels FROM public.package_hotels WHERE package_id = v_package_id;
  END IF;

  IF jsonb_typeof(p_payload->'days') = 'array' THEN
    v_days := p_payload->'days';
  ELSE
    v_days := '[]'::jsonb;
  END IF;

  -- A NULL duration_days (legacy rows predating the column, or a direct
  -- RPC create with none supplied) makes every `> v_duration_days` bound
  -- check below evaluate to NULL, so relative day placements would silently
  -- pass validation instead of being rejected. Only block the save when a
  -- relative placement is actually present; metadata-only saves on a
  -- NULL-duration row must keep working.
  IF v_duration_days IS NULL AND (
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_flights) e WHERE e->>'day_number' IS NOT NULL)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_activities) e WHERE e->>'day_number' IS NOT NULL)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_hotels) e
      WHERE e->>'check_in_day' IS NOT NULL OR e->>'check_out_day' IS NOT NULL)
  ) THEN
    v_failures := v_failures || 'duration_days must be set before saving relative day placements';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_flights) e
    WHERE e->>'day_number' IS NOT NULL
      AND ((e->>'day_number')::INT < 1 OR (e->>'day_number')::INT > v_duration_days)
  ) THEN
    v_failures := v_failures || 'flight day_number must be between 1 and duration_days';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_activities) e
    WHERE e->>'day_number' IS NOT NULL
      AND ((e->>'day_number')::INT < 1 OR (e->>'day_number')::INT > v_duration_days)
  ) THEN
    v_failures := v_failures || 'activity day_number must be between 1 and duration_days';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_days) e WHERE e->>'day_number' IS NULL
  ) THEN
    v_failures := v_failures || 'day_number is required for every day';
  END IF;

  -- Hotel relative-day bounds are checked per-field, independently, so a
  -- stay with only one of the pair set does not escape validation, plus a
  -- both-or-neither requirement and an ordering check. Concrete-date
  -- stays (no relative days at all) are untouched by any of these three.
  -- Check-out may be duration_days + 1 (the departure boundary).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_hotels) e
    WHERE (e->>'check_in_day' IS NOT NULL) <> (e->>'check_out_day' IS NOT NULL)
  ) THEN
    v_failures := v_failures || 'hotel check_in_day and check_out_day must be supplied together';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_hotels) e
    WHERE e->>'check_in_day' IS NOT NULL
      AND ((e->>'check_in_day')::INT < 1 OR (e->>'check_in_day')::INT > v_duration_days)
  ) THEN
    v_failures := v_failures || 'hotel check_in_day must be between 1 and duration_days';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_hotels) e
    WHERE e->>'check_out_day' IS NOT NULL
      AND ((e->>'check_out_day')::INT < 2 OR (e->>'check_out_day')::INT > v_duration_days + 1)
  ) THEN
    v_failures := v_failures || 'hotel check_out_day must be between 2 and duration_days + 1';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_hotels) e
    WHERE e->>'check_in_day' IS NOT NULL AND e->>'check_out_day' IS NOT NULL
      AND (e->>'check_out_day')::INT <= (e->>'check_in_day')::INT
  ) THEN
    v_failures := v_failures || 'hotel check_out_day must be after check_in_day';
  END IF;

  -- Media ownership: every media ID referenced by a supplied collection
  -- must already belong to this package. Only supplied collections are
  -- checked — media on unchanged rows was already validated when saved.
  SELECT ARRAY(
    SELECT DISTINCT m::UUID FROM (
      SELECT jsonb_array_elements_text(COALESCE(elem->'media_ids', '[]'::jsonb)) AS m
      FROM jsonb_array_elements(v_days) elem
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(elem->'media_ids', '[]'::jsonb))
      FROM jsonb_array_elements(v_flights) elem
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(elem->'media_ids', '[]'::jsonb))
      FROM jsonb_array_elements(v_hotels) elem
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(elem->'media_ids', '[]'::jsonb))
      FROM jsonb_array_elements(v_activities) elem
    ) refs
  ) INTO v_media_ids;

  IF v_media_ids IS NOT NULL AND array_length(v_media_ids, 1) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_media_ids) mid
      WHERE NOT EXISTS (
        SELECT 1 FROM public.package_media pm
        WHERE pm.media_id = mid AND pm.package_id = v_package_id
      )
    ) THEN
      v_failures := v_failures || (CASE WHEN p_package_id IS NULL
        THEN 'media_ids cannot be set on create — upload media after the package exists'
        ELSE 'media_ids must reference photos already uploaded to this package' END);
    END IF;
  END IF;

  IF array_length(v_failures, 1) > 0 THEN
    -- Nothing has been written yet — create's INSERT and update's metadata
    -- UPDATE are both deferred past this point, so an expected failure
    -- here can never leave a partial write committed.
    RETURN jsonb_build_object(
      'outcome', 'precondition_failed',
      'details', jsonb_build_object('failures', v_failures)
    );
  END IF;

  -- Validation passed: now perform the metadata write (create's INSERT,
  -- or update's partial UPDATE), followed by the collection writes below.
  IF p_package_id IS NULL THEN
    INSERT INTO public.travel_packages (
      package_id, creator_id, title, description, destination_country,
      destination_city, duration_days, base_price_aud, max_group_size, tags,
      vibes, season, status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), p_actor_id, p_payload->>'title', p_payload->>'description',
      p_payload->>'destination_country', p_payload->>'destination_city',
      v_duration_days, (p_payload->>'base_price_aud')::BIGINT,
      (p_payload->>'max_group_size')::INTEGER,
      CASE WHEN jsonb_typeof(p_payload->'tags') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ) ELSE '{}'::text[] END,
      CASE WHEN jsonb_typeof(p_payload->'vibes') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'vibes') x),
        '{}'::text[]
      ) ELSE '{}'::text[] END,
      p_payload->>'season',
      'draft', now(), now()
    ) RETURNING package_id INTO v_package_id;
  ELSE
    UPDATE public.travel_packages SET
      title = CASE WHEN p_payload ? 'title'
        THEN p_payload->>'title' ELSE title END,
      description = CASE WHEN p_payload ? 'description'
        THEN p_payload->>'description' ELSE description END,
      destination_country = CASE WHEN p_payload ? 'destination_country'
        THEN p_payload->>'destination_country' ELSE destination_country END,
      destination_city = CASE WHEN p_payload ? 'destination_city'
        THEN p_payload->>'destination_city' ELSE destination_city END,
      duration_days = v_duration_days,
      base_price_aud = CASE WHEN p_payload ? 'base_price_aud'
        THEN (p_payload->>'base_price_aud')::BIGINT ELSE base_price_aud END,
      max_group_size = CASE WHEN p_payload ? 'max_group_size'
        THEN (p_payload->>'max_group_size')::INTEGER ELSE max_group_size END,
      tags = CASE WHEN jsonb_typeof(p_payload->'tags') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ) ELSE tags END,
      vibes = CASE WHEN jsonb_typeof(p_payload->'vibes') = 'array' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'vibes') x),
        '{}'::text[]
      ) ELSE vibes END,
      season = CASE WHEN p_payload ? 'season'
        THEN p_payload->>'season' ELSE season END,
      updated_at = now()
    WHERE package_id = v_package_id;
  END IF;

  -- Collections: an array replaces the collection; [] clears it; omission
  -- (no key in p_payload) leaves it untouched. Every save writes the whole
  -- component object into `details` as the authoritative snapshot, with
  -- native columns kept as synchronized projections for existing readers.
  -- `v_flights`/`v_hotels`/`v_activities`/`v_days` (computed above) are
  -- exactly "the supplied collection, or [] if none was supplied" — reuse
  -- them here instead of re-deriving presence from p_payload.
  IF jsonb_typeof(p_payload->'flights') = 'array' THEN
    DELETE FROM public.package_flights WHERE package_id = v_package_id;
    INSERT INTO public.package_flights (
      id, package_id, flight_id, day_number, sequence_order, notes, details
    )
    SELECT gen_random_uuid(), v_package_id, NULL,
      (elem->>'day_number')::INT, (elem->>'sequence_order')::INT, elem->>'notes', elem
    FROM jsonb_array_elements(v_flights) elem;
  END IF;

  IF jsonb_typeof(p_payload->'hotels') = 'array' THEN
    DELETE FROM public.package_hotels WHERE package_id = v_package_id;
    INSERT INTO public.package_hotels (
      id, package_id, hotel_id, check_in_day, check_out_day, nights,
      check_in_date, check_out_date, notes, details
    )
    SELECT gen_random_uuid(), v_package_id, NULL,
      (elem->>'check_in_day')::INT, (elem->>'check_out_day')::INT,
      -- Effective nights: concrete dates win over relative days when both
      -- are supplied on the same stay (see header comment).
      CASE
        WHEN elem->>'check_in_date' IS NOT NULL AND elem->>'check_out_date' IS NOT NULL
          THEN ((elem->>'check_out_date')::DATE - (elem->>'check_in_date')::DATE)
        WHEN elem->>'check_in_day' IS NOT NULL AND elem->>'check_out_day' IS NOT NULL
          THEN (elem->>'check_out_day')::INT - (elem->>'check_in_day')::INT
        ELSE NULL
      END,
      (elem->>'check_in_date')::DATE, (elem->>'check_out_date')::DATE,
      elem->>'notes', elem
    FROM jsonb_array_elements(v_hotels) elem;
  END IF;

  IF jsonb_typeof(p_payload->'activities') = 'array' THEN
    DELETE FROM public.package_activities WHERE package_id = v_package_id;
    INSERT INTO public.package_activities (
      id, package_id, activity_id, day_number, sequence_order, activity_date,
      notes, details
    )
    SELECT gen_random_uuid(), v_package_id, NULL,
      (elem->>'day_number')::INT, (elem->>'sequence_order')::INT,
      (elem->>'activity_date')::DATE, elem->>'notes', elem
    FROM jsonb_array_elements(v_activities) elem;
  END IF;

  IF jsonb_typeof(p_payload->'days') = 'array' THEN
    -- Exact day-number replacement: prune rows whose day_number is not in
    -- the supplied set (via NOT EXISTS, not NOT IN — a NULL day_number in
    -- the subquery would make NOT IN NULL for every row and prune nothing;
    -- the validation block above also rejects a missing day_number
    -- outright, so this is defense in depth), rather than trimming by
    -- array length (days need not be contiguous).
    DELETE FROM public.package_days pd
    WHERE pd.package_id = v_package_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_days) elem
        WHERE (elem->>'day_number')::INT = pd.day_number
      );

    INSERT INTO public.package_days (id, package_id, day_number, title, summary, meta, media_ids)
    SELECT gen_random_uuid(), v_package_id, (elem->>'day_number')::INT,
      elem->>'title', elem->>'summary', elem->>'meta',
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(elem->'media_ids', '[]'::jsonb)))::UUID[],
        '{}'::UUID[]
      )
    FROM jsonb_array_elements(v_days) elem
    ON CONFLICT (package_id, day_number) DO UPDATE SET
      title = EXCLUDED.title, summary = EXCLUDED.summary, meta = EXCLUDED.meta,
      media_ids = EXCLUDED.media_ids;
  END IF;
  -- A missing "days" key, or an explicit JSON null (back-compat), both
  -- fail jsonb_typeof(...) = 'array' above and are preserved as "no
  -- change"; nothing to do here.

  RETURN jsonb_build_object('outcome', 'ok', 'package_id', v_package_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
