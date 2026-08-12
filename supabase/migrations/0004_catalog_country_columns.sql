-- City names collide across countries (e.g. Melbourne AU vs Melbourne US),
-- so catalog rows carry explicit country columns. hotels already has one.
-- Flights are technically unambiguous via IATA codes, but explicit countries
-- make querying/display easier.
ALTER TABLE public.activities ADD COLUMN country TEXT;
ALTER TABLE public.flights
  ADD COLUMN origin_country TEXT,
  ADD COLUMN destination_country TEXT;
