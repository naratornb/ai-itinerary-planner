import assert from "node:assert/strict";
import test from "node:test";

import { annotateItems, deriveFlightType, findTimeConflict, referenceFlightPresentation } from "./itinerary-editor";
import type { TimelineItem } from "../lib/itinerary-builder";

function item(overrides: Partial<TimelineItem> & { id: number; time: string }): TimelineItem {
  return {
    type: "ACTIVITY",
    title: "Stop",
    price: "$0",
    icon: "star",
    status: "pass",
    duration: "60",
    ...overrides,
  };
}

test("a start time before the previous stop's end is rejected", () => {
  const items = [
    item({ id: 1, time: "09:00", duration: "60", title: "Breakfast" }), // ends 10:00
    item({ id: 2, time: "09:30", duration: "60" }),
  ];

  const conflict = findTimeConflict(items, 2, "09:30", "60");

  assert.match(conflict ?? "", /Breakfast ends, at 10:00/);
});

test("a start time that would run past the next stop's start is rejected, phrased as a start-time limit", () => {
  // Duration is fixed — only the start time can move — so the message must
  // tell the user the latest valid *start*, not just when it needs to end.
  const items = [
    item({ id: 1, time: "09:00", duration: "180" }),
    item({ id: 2, time: "12:00", duration: "60", title: "Lunch" }),
  ];

  const conflict = findTimeConflict(items, 1, "09:00", "240");

  assert.equal(conflict, "Must start by 08:00, so it ends before Lunch starts at 12:00");
});

test("a start time already later than the next stop's start is still rejected, not just its end", () => {
  // Regression: setting a start time later than the next stop's own start
  // (13:00 vs. 09:00) must be caught even though the earlier check only
  // compares this item's *end* against the next item's start.
  const items = [
    item({ id: 1, time: "09:00", duration: "216", title: "Tokyo Street Food Walking Tour" }),
    item({ id: 2, time: "09:00", duration: "60", title: "Tokyo Cooking Class with Local Chef" }),
  ];

  const conflict = findTimeConflict(items, 1, "13:00", "216");

  assert.equal(conflict, "Must start by 05:24, so it ends before Tokyo Cooking Class with Local Chef starts at 09:00");
});

test("a start time that fits between neighbors has no conflict", () => {
  const items = [
    item({ id: 1, time: "09:00", duration: "60" }),
    item({ id: 2, time: "10:30", duration: "60" }),
    item({ id: 3, time: "13:00", duration: "60" }),
  ];

  assert.equal(findTimeConflict(items, 2, "11:00", "60"), null);
});

test("a flight neighbor's own arrival time is its end — duration isn't added on top", () => {
  // A flight's `time` is its arrival (landing), and `duration` is its travel time
  // (e.g. ~6hrs SYD->DPS). Regression: adding duration to the arrival time double-
  // counts the flight, pushing "ends at" hours past when it actually landed and
  // falsely blocking an activity that starts well after the real arrival.
  const items = [
    item({ id: 1, time: "15:06", duration: "366", type: "FLIGHT", title: "SYD to DPS" }),
    item({ id: 2, time: "17:00", duration: "174", title: "Denpasar Old Town Photography Tour" }),
  ];

  assert.equal(findTimeConflict(items, 2, "17:00", "174"), null);
});

test("editing the flight itself doesn't double-count its own duration against the next item", () => {
  // Same bug, mirrored: this time the FLIGHT is the item being checked (editingId
  // points at it), not the neighbor. `time`="15:06" is the flight's own arrival;
  // checking it against the next item's start must not add the 366min travel
  // duration on top, or a flight landing at 15:06 looks like it "ends" at 21:12 and
  // falsely conflicts with an activity starting at 16:00.
  const items = [
    item({ id: 1, time: "15:06", duration: "366", type: "FLIGHT", title: "SYD to DPS" }),
    item({ id: 2, time: "16:00", duration: "174", title: "Denpasar Old Town Photography Tour" }),
  ];

  assert.equal(findTimeConflict(items, 1, "15:06", "366"), null);
});

test("annotateItems has the same flight-duration fix — no false 'Overlaps next item' badge", () => {
  // Same root cause as findTimeConflict above, but this is the separate code path that
  // drives the live on-screen timeline badge (no editing in progress) — it had the
  // identical double-counting bug and needed the identical fix.
  const items = [
    item({ id: 1, time: "15:06", duration: "366", type: "FLIGHT", title: "SYD to DPS" }),
    item({ id: 2, time: "17:00", duration: "174", title: "Denpasar Old Town Photography Tour" }),
  ];

  const [, activity] = annotateItems(items);
  assert.equal(activity.status, "pass");
  assert.equal(activity.problem, undefined);
});

test("a neighbor without a real clock time (an overnight hotel stay) is ignored", () => {
  const items = [
    item({ id: 1, time: "Overnight stay", type: "HOTEL", duration: "0" }),
    item({ id: 2, time: "09:00", duration: "60" }),
  ];

  assert.equal(findTimeConflict(items, 2, "07:00", "60"), null);
});

test("a hotel check-in has no hard deadline, so it never forces the stop before it to end early", () => {
  // Arriving at the hotel late doesn't block anything — you check in
  // whenever you get there. Its own displayed time is "Check-in", not a
  // real clock value (buildDaysFromPackage never fabricates one).
  const items = [
    item({ id: 1, time: "09:00", duration: "480", title: "All-day tour" }), // ends 17:00
    item({ id: 2, time: "Check-in", type: "HOTEL", title: "Tokyo Garden Residence" }),
  ];

  assert.equal(findTimeConflict(items, 1, "09:00", "480"), null);
});

test("a hotel's own check-in slot is never flagged against a real neighbor, since it has no real clock time to compare", () => {
  // "Check-in" carries no time of day — hotel bookings only ever have a
  // date — so comparing it against the flight's real arrival would raise a
  // conflict nobody can resolve, since there's no clock value to edit.
  const items = [
    item({ id: 1, time: "15:23", type: "FLIGHT", title: "Sydney (SYD) to Tokyo (NRT)", duration: "0" }),
    item({ id: 2, time: "Check-in", type: "HOTEL", title: "Tokyo Garden Residence" }),
  ];

  assert.equal(findTimeConflict(items, 2, "Check-in", "0"), null);
});

test("a selected flight is presented as a reference rather than a confirmed booking", () => {
  const presentation = referenceFlightPresentation(
    item({
      id: 1,
      time: "09:30",
      type: "FLIGHT",
      title: "SYD to HND",
      price: "$850",
      icon: "plane",
      originIata: "SYD",
      destinationIata: "HND",
      flightNumber: "QF25",
      departureTime: "09:30",
      arrivalTime: "17:00",
      cabinClass: "economy",
    }),
  );

  assert.deepEqual(presentation, {
    label: "REFERENCE FLIGHT",
    subtitle: "Creator’s suggested option",
    title: "QF25 · SYD → HND",
    schedule: "09:30–17:00 · Economy",
    priceLabel: "Estimated",
    price: "$850",
    guidance: "Travellers will see similar flights for their dates and departure airport.",
  });
});

test("deriveFlightType: SYD to DPS is international, not domestic — the reported bug", () => {
  // Regression: the old title-text match ("does the title literally say the word
  // 'international'?") always resolved to domestic, since titles are just IATA codes.
  assert.equal(deriveFlightType("SYD", "DPS", "Indonesia"), "international");
});

test("deriveFlightType: both endpoints inside the AU network is domestic", () => {
  assert.equal(deriveFlightType("SYD", "MEL", "Australia"), "domestic");
});

test("deriveFlightType: an international leg inside an otherwise-Australian package is still international", () => {
  // Regression: a package-wide "destination_country === Australia" check alone would
  // mislabel this leg domestic even though it actually leaves the country.
  assert.equal(deriveFlightType("SYD", "NRT", "Australia"), "international");
});

test("deriveFlightType: known limitation — a genuine domestic hop in a non-AU country falls back to destination_country and gets it wrong", () => {
  // NRT->KIX is actually a domestic Japan flight, but neither airport is in the AU
  // set, so there's no per-leg signal to use and this falls back to the same
  // "is destination_country Australia?" heuristic as before — which only encodes
  // "Australia vs not," so it still can't recognize a domestic hop inside any other
  // single country. Documenting this as a known gap, not a claim it's handled: fixing
  // it fully needs a real airport->country dataset, out of scope for this fix.
  assert.equal(deriveFlightType("NRT", "KIX", "Japan"), "international");
});

test("deriveFlightType: missing IATA codes fall back to destination_country", () => {
  assert.equal(deriveFlightType(undefined, undefined, "Australia"), "domestic");
  assert.equal(deriveFlightType(undefined, undefined, "Indonesia"), "international");
});
