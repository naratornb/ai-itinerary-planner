import assert from "node:assert/strict";
import test from "node:test";

import {
  dateAfter,
  estimateBookingTotal,
  flightsOn,
  iataPattern,
  type CatalogFlight,
} from "./booking-options";

const flight = (id: string, dt: string, price: number): CatalogFlight => ({
  flight_id: id,
  airline: "Test Air",
  departure_datetime: dt,
  cabin_class: "economy",
  price_aud: price,
});

test("flightsOn keeps only catalog rows departing on the given date", () => {
  const list = [
    flight("a", "2026-11-13T22:45:00Z", 860),
    flight("b", "2026-11-14T22:45:00Z", 900),
    flight("c", "2026-11-13T06:00:00Z", 984),
  ];
  assert.deepEqual(flightsOn(list, "2026-11-13").map((f) => f.flight_id), ["a", "c"]);
  assert.deepEqual(flightsOn(list, "2026-01-01"), []);
  assert.deepEqual(flightsOn(null, "2026-11-13"), []);
  assert.deepEqual(flightsOn(list, null), []);
});

test("iataPattern matches decorated and bare airport codes", () => {
  assert.equal(iataPattern("Brisbane (BNE)"), "%(BNE)");
  assert.equal(iataPattern("BNE"), "%(BNE)");
  assert.equal(iataPattern("melbourne (mel)"), "%(MEL)");
});

test("dateAfter shifts a YYYY-MM-DD date, null-safe", () => {
  assert.equal(dateAfter("2026-11-13", 5), "2026-11-18");
  assert.equal(dateAfter("2026-12-30", 3), "2027-01-02");
  assert.equal(dateAfter(null, 5), null);
});

test("estimateBookingTotal applies per-seat flight and per-room hotel deltas", () => {
  // base $9,290 ×2; outbound swap +$4/seat; hotel swap −$581/night ×6 nights
  assert.equal(
    estimateBookingTotal({ basePrice: 9290, travelers: 2, flightDelta: 4, hotelNightlyDelta: -581, nights: 6 }),
    15102,
  );
  assert.equal(
    estimateBookingTotal({ basePrice: 9290, travelers: 2, flightDelta: 0, hotelNightlyDelta: 0, nights: 6 }),
    18580,
  );
  assert.equal(
    estimateBookingTotal({ basePrice: null, travelers: 2, flightDelta: 0, hotelNightlyDelta: 0, nights: 6 }),
    null,
  );
});
