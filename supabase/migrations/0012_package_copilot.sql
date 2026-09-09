-- Package-scoped conversations, independent of legacy ai_suggestions.
CREATE TABLE public.copilot_turns (
  turn_id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES public.travel_packages(package_id) ON DELETE CASCADE,
  prompt TEXT NOT NULL CHECK (char_length(btrim(prompt)) BETWEEN 1 AND 1000),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  context JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(context) = 'object'),
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX copilot_turns_package_history ON public.copilot_turns(package_id, created_at DESC, turn_id DESC);

CREATE TABLE public.copilot_suggestions (
  turn_id UUID NOT NULL REFERENCES public.copilot_turns(turn_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4),
  item_type TEXT NOT NULL CHECK (item_type IN ('activity', 'hotel', 'flight')),
  item_name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT,
  price_aud NUMERIC,
  price_unit TEXT NOT NULL CHECK (price_unit IN ('per_person', 'per_night')),
  rating DOUBLE PRECISION,
  details JSONB NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  why_recommended TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  PRIMARY KEY (turn_id, item_id)
);
CREATE INDEX copilot_suggestions_dismissed ON public.copilot_suggestions(turn_id) WHERE status = 'dismissed';

ALTER TABLE public.copilot_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read co-pilot turns" ON public.copilot_turns
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.travel_packages p WHERE p.package_id = copilot_turns.package_id AND p.creator_id = auth.uid()
  ));
CREATE POLICY "Owners create co-pilot turns" ON public.copilot_turns
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.travel_packages p WHERE p.package_id = copilot_turns.package_id AND p.creator_id = auth.uid()
  ));
CREATE POLICY "Owners read co-pilot suggestions" ON public.copilot_suggestions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.copilot_turns t WHERE t.turn_id = copilot_suggestions.turn_id
  ));
CREATE POLICY "Owners create co-pilot suggestions" ON public.copilot_suggestions
  FOR INSERT TO authenticated WITH CHECK (status = 'pending' AND EXISTS (
    SELECT 1 FROM public.copilot_turns t WHERE t.turn_id = copilot_suggestions.turn_id
  ));
CREATE POLICY "Owners resolve pending co-pilot suggestions" ON public.copilot_suggestions
  FOR UPDATE TO authenticated USING (status = 'pending' AND EXISTS (
    SELECT 1 FROM public.copilot_turns t WHERE t.turn_id = copilot_suggestions.turn_id
  )) WITH CHECK (status IN ('accepted', 'dismissed') AND EXISTS (
    SELECT 1 FROM public.copilot_turns t WHERE t.turn_id = copilot_suggestions.turn_id
  ));

-- Feedback cannot rewrite the inventory snapshot or move a suggestion to another turn.
REVOKE ALL ON public.copilot_turns, public.copilot_suggestions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.copilot_turns, public.copilot_suggestions TO authenticated;
GRANT UPDATE (status) ON public.copilot_suggestions TO authenticated;

-- A single PostgREST transaction saves both the turn and its inventory snapshots.
-- SECURITY INVOKER preserves caller RLS; no service-role credential is needed.
CREATE FUNCTION public.save_copilot_turn(
  p_turn_id UUID, p_package_id UUID, p_prompt TEXT, p_result JSONB,
  p_context JSONB, p_suggestions JSONB, p_response_time_ms INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved public.copilot_turns;
BEGIN
  IF p_suggestions IS NULL OR jsonb_typeof(p_suggestions) <> 'array' OR jsonb_array_length(p_suggestions) > 5 THEN
    RAISE EXCEPTION 'Expected at most five suggestions';
  END IF;
  INSERT INTO public.copilot_turns(turn_id, package_id, prompt, result, context, response_time_ms)
    VALUES (p_turn_id, p_package_id, p_prompt, p_result, p_context, p_response_time_ms)
    RETURNING * INTO saved;
  INSERT INTO public.copilot_suggestions
    (turn_id, position, item_id, item_type, item_name, city, country, price_aud, price_unit, rating, details, why_recommended)
    SELECT p_turn_id, (entry.ordinality - 1)::integer, x.item_id, x.item_type, x.item_name, x.city, x.country,
           x.price_aud, x.price_unit, x.rating, x.details, x.why_recommended
    FROM jsonb_array_elements(p_suggestions) WITH ORDINALITY AS entry(value, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(entry.value) AS x(
      item_id TEXT, item_type TEXT, item_name TEXT, city TEXT, country TEXT,
      price_aud NUMERIC, price_unit TEXT, rating DOUBLE PRECISION, details JSONB, why_recommended TEXT
    );
  RETURN to_jsonb(saved) || jsonb_build_object('suggestions', COALESCE((
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.position) FROM public.copilot_suggestions s WHERE s.turn_id = p_turn_id
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.save_copilot_turn(UUID, UUID, TEXT, JSONB, JSONB, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_copilot_turn(UUID, UUID, TEXT, JSONB, JSONB, JSONB, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
