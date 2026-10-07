import assert from "node:assert/strict";
import test from "node:test";

import {
  dateAfter,
  defaultTravelers,
  estimateBookingTotal,
  flightsOn,
  iataPattern,
  pickFlightLegs,
  type CatalogFlight,
  type PackageFlight,
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

test("defaultTravelers clamps the two-traveler default into the group limit", () => {
  // Regression: max_group_size=1 left the select showing "1" while state (and
  // the estimate) stayed at 2 travelers.
  assert.equal(defaultTravelers(undefined), 2);
  assert.equal(defaultTravelers(null), 2);
  assert.equal(defaultTravelers(8), 2);
  assert.equal(defaultTravelers(1), 1);
  assert.equal(defaultTravelers(0), 1);
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

const leg = (day: number | null, dt: string | null, id = ""): PackageFlight => ({
  flight_id: id || null,
  day_number: day,
  departure_datetime: dt,
});

test("pickFlightLegs splits outbound and return legs", () => {
  // Regression: the last leg was always treated as the return, so a two-leg
  // same-day connection (e.g. SYD→HKG→NRT) showed a "return flight" selector
  // and charged a return delta for a leg that departs on day 1.
  const out = leg(1, "2026-03-10T09:00:00Z", "out");
  const conn = leg(1, "2026-03-10T18:00:00Z", "conn");
  const ret = leg(10, "2026-03-19T11:00:00Z", "ret");

  assert.deepEqual(pickFlightLegs([out, ret]), { outbound: out, returnLeg: ret });
  assert.deepEqual(pickFlightLegs([out, conn, ret]), { outbound: out, returnLeg: ret });
  assert.deepEqual(pickFlightLegs([out, conn]), { outbound: out, returnLeg: null });
  assert.deepEqual(pickFlightLegs([out]), { outbound: out, returnLeg: null });

  // Datetime fallback when day_number is missing on the later leg.
  const noDay = leg(null, "2026-03-19T11:00:00Z", "ret");
  assert.deepEqual(pickFlightLegs([out, noDay]), { outbound: out, returnLeg: noDay });
});
