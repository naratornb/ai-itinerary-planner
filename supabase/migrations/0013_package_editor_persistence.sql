-- ============================================================
-- Package editor persistence (Task B): atomic complete-save RPC.
--
-- Reuses package_flights/package_hotels/package_activities/package_days
-- rather than adding a second itinerary model. Each junction table gets a
-- nullable `details JSONB` column holding the complete, validated component
-- input as submitted by the editor; the catalog foreign key becomes
-- nullable so a freshly saved component need not create/reuse a shared
-- catalog row. Native day/date/order/notes columns stay in sync as
-- projections used by existing readers and ordering — `details` is the
-- authoritative snapshot for anything not covered by those columns.
--
-- Legacy rows (details IS NULL) keep the pre-existing catalog-plus-junction
-- read path (Task C's concern, not touched here).
--
-- This file is append-only: Task C (media-delete trigger) and Task D
-- (submit_package_for_review) add their own sections below, after the
-- marker comments.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Junction tables — nullable catalog FK + details snapshot
-- ─────────────────────────────────────────────
ALTER TABLE public.package_flights
  ALTER COLUMN flight_id DROP NOT NULL,
  ADD COLUMN details JSONB,
  ADD CONSTRAINT package_flights_details_is_object
    CHECK (details IS NULL OR jsonb_typeof(details) = 'object');

ALTER TABLE public.package_hotels
  ALTER COLUMN hotel_id DROP NOT NULL,
  ADD COLUMN details JSONB,
  ADD CONSTRAINT package_hotels_details_is_object
    CHECK (details IS NULL OR jsonb_typeof(details) = 'object');

ALTER TABLE public.package_activities
  ALTER COLUMN activity_id DROP NOT NULL,
  ADD COLUMN details JSONB,
  ADD CONSTRAINT package_activities_details_is_object
    CHECK (details IS NULL OR jsonb_typeof(details) = 'object');

-- `id` (existing PK on each junction table) is what the API exposes as
-- package_component_id (Task C's read-back conversion); no column change
-- needed here.

-- ─────────────────────────────────────────────
-- 2. package_days — narrative metadata + ordered media
-- ─────────────────────────────────────────────
ALTER TABLE public.package_days
  ADD COLUMN meta TEXT,
  ADD COLUMN media_ids UUID[] NOT NULL DEFAULT '{}';

-- ─────────────────────────────────────────────
-- 3. save_package_details RPC
--
-- p_package_id NULL means create. Locks the owned package row before
-- checking status or writing anything (create has no row to lock — the
-- INSERT itself is the atomic unit). Ownership mismatch is reported as
-- not_found, matching the existing PostgREST-based service behavior.
--
-- Validates the FINAL merged package (including collections the caller
-- did not resupply) before any mutation — including the create INSERT and
-- the metadata UPDATE — so a shrinking duration_days is caught even when
-- flights/hotels/activities are left unchanged, and an expected failure
-- never leaves a partial write (e.g. an orphan draft, or a shrunk
-- duration_days with components that now violate it) committed.
--
-- Hotel effective nights: concrete check_in_date/check_out_date win over
-- relative check_in_day/check_out_day when both are present on the same
-- stay — dates are the more specific, unambiguous representation.
--
-- SECURITY DEFINER: ownership is checked explicitly inside the function
-- (creator_id = p_actor_id) rather than relied on via RLS/auth.uid(),
-- because the only caller is the API server using service-role
-- credentials, not the acting user's own JWT.
-- ─────────────────────────────────────────────
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
      FROM jsonb_array_elements(COALESCE(p_payload->'flights', '[]'::jsonb)) elem
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(elem->'media_ids', '[]'::jsonb))
      FROM jsonb_array_elements(COALESCE(p_payload->'hotels', '[]'::jsonb)) elem
      UNION ALL
      SELECT jsonb_array_elements_text(COALESCE(elem->'media_ids', '[]'::jsonb))
      FROM jsonb_array_elements(COALESCE(p_payload->'activities', '[]'::jsonb)) elem
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
      v_failures := v_failures ||
        'media_ids must reference photos already uploaded to this package';
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
      status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), p_actor_id, p_payload->>'title', p_payload->>'description',
      p_payload->>'destination_country', p_payload->>'destination_city',
      v_duration_days, (p_payload->>'base_price_aud')::BIGINT,
      (p_payload->>'max_group_size')::INTEGER,
      COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ),
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
      tags = CASE WHEN p_payload ? 'tags' THEN COALESCE(
        (SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'tags') x),
        '{}'::text[]
      ) ELSE tags END,
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

REVOKE ALL ON FUNCTION public.save_package_details(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_package_details(UUID, UUID, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Task C: media-delete trigger.
--
-- Component media IDs live inside typed `details` (junction tables) and in
-- package_days.media_ids; both are just projections of media_id values that
-- must exist in package_media. Without this trigger, deleting a photo would
-- leave a dangling media_id in a day/component association forever.
--
-- Runs BEFORE DELETE on package_media, per row:
--   1. Locks the parent travel_packages row (FOR UPDATE) — orders media
--      deletion against concurrent save_package_details/submit_package_for_
--      review calls on the same package.
--   2. Enforces the same draft/rejected editable window as save/submit. A
--      concurrent submit that already flipped status is a known race the
--      API precheck cannot see; the trigger is the authority and raises so
--      the API can map it to the existing 409 PACKAGE_NOT_EDITABLE contract
--      (see app/media/service.py) instead of silently deleting a photo out
--      from under an in-flight review.
--   3. Removes the deleted media_id from every day/component association in
--      the same transaction as the row delete, so no dangling reference can
--      ever be observed.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_media_deletion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status
  FROM public.travel_packages
  WHERE package_id = OLD.package_id
  FOR UPDATE;

  -- No parent row (already deleted, e.g. package cascade) — nothing to
  -- guard or clean up; let the delete proceed.
  IF v_status IS NOT NULL AND v_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION
      'PACKAGE_NOT_EDITABLE: package % is not editable (status %)',
      OLD.package_id, v_status;
  END IF;

  UPDATE public.package_days
  SET media_ids = array_remove(media_ids, OLD.media_id)
  WHERE package_id = OLD.package_id
    AND OLD.media_id = ANY(media_ids);

  -- The three UPDATEs below are intentional verbatim triplicates, differing
  -- only in table name — package_flights/package_hotels/package_activities
  -- each carry their own `details` snapshot with no shared parent row to
  -- update once. If you fix a bug in one (e.g. the ordering below), fix it
  -- in all three.
  UPDATE public.package_flights
  SET details = details || jsonb_build_object(
    'media_ids',
    COALESCE(
      -- WITH ORDINALITY + jsonb_agg(... ORDER BY ord): plain jsonb_agg over
      -- a set-returning function has no guaranteed row order, but the plan
      -- requires ordered media_ids — preserve the original position of
      -- every element that survives the filter.
      (SELECT jsonb_agg(val ORDER BY ord)
       FROM jsonb_array_elements_text(details->'media_ids') WITH ORDINALITY AS t(val, ord)
       WHERE val <> OLD.media_id::text),
      '[]'::jsonb
    )
  )
  WHERE package_id = OLD.package_id
    AND details ? 'media_ids'
    AND details->'media_ids' @> to_jsonb(OLD.media_id::text);

  UPDATE public.package_hotels
  SET details = details || jsonb_build_object(
    'media_ids',
    COALESCE(
      -- WITH ORDINALITY + jsonb_agg(... ORDER BY ord): plain jsonb_agg over
      -- a set-returning function has no guaranteed row order, but the plan
      -- requires ordered media_ids — preserve the original position of
      -- every element that survives the filter.
      (SELECT jsonb_agg(val ORDER BY ord)
       FROM jsonb_array_elements_text(details->'media_ids') WITH ORDINALITY AS t(val, ord)
       WHERE val <> OLD.media_id::text),
      '[]'::jsonb
    )
  )
  WHERE package_id = OLD.package_id
    AND details ? 'media_ids'
    AND details->'media_ids' @> to_jsonb(OLD.media_id::text);

  UPDATE public.package_activities
  SET details = details || jsonb_build_object(
    'media_ids',
    COALESCE(
      -- WITH ORDINALITY + jsonb_agg(... ORDER BY ord): plain jsonb_agg over
      -- a set-returning function has no guaranteed row order, but the plan
      -- requires ordered media_ids — preserve the original position of
      -- every element that survives the filter.
      (SELECT jsonb_agg(val ORDER BY ord)
       FROM jsonb_array_elements_text(details->'media_ids') WITH ORDINALITY AS t(val, ord)
       WHERE val <> OLD.media_id::text),
      '[]'::jsonb
    )
  )
  WHERE package_id = OLD.package_id
    AND details ? 'media_ids'
    AND details->'media_ids' @> to_jsonb(OLD.media_id::text);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS package_media_before_delete ON public.package_media;
CREATE TRIGGER package_media_before_delete
  BEFORE DELETE ON public.package_media
  FOR EACH ROW EXECUTE FUNCTION public.enforce_media_deletion_guard();

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Task D: submit_package_for_review RPC.
--
-- Mirrors save_package_details' locking convention: SELECT ... FOR UPDATE
-- on the owned row BEFORE reading component counts or status, so a
-- concurrent save cannot race the submit precondition check (the bug this
-- task fixes — checking components first and locking only for the status
-- write would leave the race open). Ownership mismatch is not_found, same
-- as save. Component presence counts junction ROWS (not non-null catalog
-- IDs), so custom components with NULL flight_id/hotel_id/activity_id
-- still count. Status/count/price failures are all collected into one
-- precondition_failed response (matching the pre-RPC service behavior and
-- its existing 422 SUBMISSION_PRECONDITION_FAILED contract) rather than a
-- separate not_editable outcome — submission never returns 409.
-- ─────────────────────────────────────────────
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
  v_flight_count INT;
  v_hotel_count INT;
  v_activity_count INT;
  v_missing TEXT[] := '{}';
  v_failures TEXT[] := '{}';
BEGIN
  IF p_actor_id IS NULL OR p_package_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Lock before reading component counts or status — the whole point of
  -- this RPC (see header comment).
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

  SELECT count(*) INTO v_flight_count FROM public.package_flights WHERE package_id = p_package_id;
  SELECT count(*) INTO v_hotel_count FROM public.package_hotels WHERE package_id = p_package_id;
  SELECT count(*) INTO v_activity_count FROM public.package_activities WHERE package_id = p_package_id;

  IF v_flight_count = 0 THEN v_missing := v_missing || 'flight'; END IF;
  IF v_hotel_count = 0 THEN v_missing := v_missing || 'hotel'; END IF;
  IF v_activity_count = 0 THEN v_missing := v_missing || 'activity'; END IF;

  IF array_length(v_missing, 1) > 0 THEN
    v_failures := v_failures || (
      'Package must have at least one ' || array_to_string(v_missing, ', ') || '.'
    );
  END IF;

  IF COALESCE(v_base_price_aud, 0) <= 0 THEN
    v_failures := v_failures || 'base_price_aud must be greater than 0.';
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
