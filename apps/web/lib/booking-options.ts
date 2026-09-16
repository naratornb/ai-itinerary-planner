// Catalog rows that back the marketplace booking card's real choices.
// A flight option is a specific dated departure on the package's route;
// a hotel option is a different property in the destination city.
export type CatalogFlight = {
  flight_id: string;
  airline: string | null;
  departure_datetime: string;
  cabin_class: string | null;
  price_aud: number | null;
};

export type CatalogHotel = {
  hotel_id: string;
  hotel_name: string | null;
  star_rating: number | null;
  room_type: string | null;
  price_per_night_aud: number | null;
};

export type CatalogOptions = {
  outbound: CatalogFlight[];
  returnLeg: CatalogFlight[];
  hotels: CatalogHotel[];
};

/** Catalog flights departing on `date` (YYYY-MM-DD). */
export function flightsOn(list: CatalogFlight[] | null | undefined, date: string | null): CatalogFlight[] {
  if (!date) return [];
  return (list ?? []).filter((f) => f.departure_datetime.slice(0, 10) === date);
}

// `origin_iata` arrives decorated ("Brisbane (BNE)") from the catalog read
// path, or bare ("BNE") from saved component details — this PostgREST ilike
// pattern matches either.
export function iataPattern(value: string): string {
  return `%(${(value.match(/\(([A-Z]{3})\)/i)?.[1] ?? value).toUpperCase()})`;
}

/** The date `offset` days after `departure` (YYYY-MM-DD), or null. */
export function dateAfter(departure: string | null, offset: number): string | null {
  if (!departure) return null;
  const d = new Date(`${departure}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Estimated request total: per-person base × travelers, plus real catalog
 * deltas — flight swaps are per-seat (× travelers), hotel swap is per-room
 * (once, × nights). Null when the package has no base price. */
export function estimateBookingTotal(opts: {
  basePrice: number | null;
  travelers: number;
  flightDelta: number;
  hotelNightlyDelta: number;
  nights: number;
}): number | null {
  if (opts.basePrice == null) return null;
  return opts.basePrice * opts.travelers + opts.flightDelta * opts.travelers + opts.hotelNightlyDelta * opts.nights;
}
