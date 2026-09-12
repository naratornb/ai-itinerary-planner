import assert from "node:assert/strict";
import test from "node:test";

import { findTimeConflict } from "./itinerary-editor";
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
