-- ============================================================
-- Marketplace full-text search: generated tsvector column on
-- travel_packages + search_packages() RPC for the public
-- marketplace (anon callers).
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. search_tsv — weighted document per package.
--    All inputs are IMMUTABLE (to_tsvector with an explicit
--    regconfig, array_to_string on text[]), so the column can
--    be GENERATED ... STORED.
-- ─────────────────────────────────────────────
ALTER TABLE public.travel_packages ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(destination_city, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED;

CREATE INDEX idx_travel_packages_search ON public.travel_packages USING GIN (search_tsv);

-- ─────────────────────────────────────────────
-- 2. search_packages — ranked, filtered, paginated.
--    SECURITY INVOKER (default): the caller is anon and the
--    status = 'live' predicate matches the 0003 §6 SELECT policy.
--    ponytail: lean by design — ids and card fields only. The API
--    layer fetches influencer display info and cover images with a
--    second PostgREST call keyed on the returned package_ids;
--    joining them here would drag profiles/package_media through
--    every ranked scan.
-- ─────────────────────────────────────────────
CREATE FUNCTION public.search_packages(
  q            TEXT,
  dest_country TEXT   DEFAULT NULL,
  min_price    BIGINT DEFAULT NULL,
  max_price    BIGINT DEFAULT NULL,
  filter_tags  TEXT[] DEFAULT NULL,
  page         INT    DEFAULT 1,
  per_page     INT    DEFAULT 20
)
RETURNS TABLE (
  package_id          UUID,
  title               TEXT,
  destination_country TEXT,
  destination_city    TEXT,
  duration_days       INTEGER,
  base_price_aud      BIGINT,
  tags                TEXT[],
  published_at        TIMESTAMPTZ,
  relevance_score     REAL,
  total_count         BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    tp.package_id,
    tp.title,
    tp.destination_country,
    tp.destination_city,
    tp.duration_days,
    tp.base_price_aud,
    tp.tags,
    tp.published_at,
    ts_rank(tp.search_tsv, websearch_to_tsquery('english', q)) AS relevance_score,
    COUNT(*) OVER () AS total_count
  FROM public.travel_packages tp
  WHERE tp.status = 'live'
    AND tp.search_tsv @@ websearch_to_tsquery('english', q)
    AND (dest_country IS NULL OR tp.destination_country ILIKE '%' || dest_country || '%')
    AND (min_price    IS NULL OR tp.base_price_aud >= min_price)
    AND (max_price    IS NULL OR tp.base_price_aud <= max_price)
    AND (filter_tags  IS NULL OR tp.tags && filter_tags)
  ORDER BY relevance_score DESC, tp.published_at DESC
  LIMIT per_page OFFSET (page - 1) * per_page;
$$;

GRANT EXECUTE ON FUNCTION public.search_packages TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
