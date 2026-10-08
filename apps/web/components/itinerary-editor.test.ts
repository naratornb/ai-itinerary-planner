import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { annotateItems, deriveFlightType, findTimeConflict, flightForItem, isCreatorPickComplete, placeUnassociatedMedia, referenceFlightPresentation, removeItemPhotoFromDays } from "./itinerary-editor";
import type { BuilderDay, TimelineItem } from "../lib/itinerary-builder";

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

test("annotateItems does not flag ordinary words containing 'y' as consonant runs as gibberish", () => {
  // Regression: "countryside" has "ntrys" — 5 consecutive letters that are all
  // non-vowels when "y" is (wrongly) never counted as a vowel — which tripped the
  // 5-consonant-run gibberish heuristic on completely normal, readable text.
  const items = [
    item({
      id: 1,
      time: "09:00",
      notes:
        "Take in breathtaking winter landscapes and charming rural villages. Enjoy a hearty traditional lunch at a countryside tavern.",
    }),
  ];

  const [annotated] = annotateItems(items);
  assert.equal(annotated.status, "pass");
  assert.equal(annotated.problem, undefined);
});

test("annotateItems still flags actual gibberish notes", () => {
  const items = [item({ id: 1, time: "09:00", notes: "xkjqzwv plrmfnbght vwxzklrq" })];

  const [annotated] = annotateItems(items);
  assert.equal(annotated.status, "critical");
  assert.equal(annotated.problem, "Description contains unreadable text");
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

function builderDay(day: number, overrides: Partial<BuilderDay> = {}): BuilderDay {
  return { id: `day-${day}`, day, title: `Day ${day}`, meta: "", items: [], story: "", photos: [], ...overrides };
}

test("placeUnassociatedMedia returns an unsaved upload to its recorded day", () => {
  // Regression: a day-3 upload refreshed before Save Draft used to land on
  // day 1 — media rows have no server-side day, so the pending stash is
  // the only record of where the photo belongs.
  const days = [builderDay(1), builderDay(2), builderDay(3)];
  const media = [{ media_id: "m1", url: "u1", caption: null }];

  const placed = placeUnassociatedMedia(days, media, { m1: 3 });

  assert.equal(placed[2].photos[0]?.media_id, "m1");
  assert.equal(placed[0].photos.length, 0);
});

test("placeUnassociatedMedia keeps the day-1 fallback when no pending day was recorded", () => {
  const days = [builderDay(1), builderDay(2)];

  const placed = placeUnassociatedMedia(days, [{ media_id: "m1", url: "u1" }], {});

  assert.equal(placed[0].photos[0]?.media_id, "m1");
});

test("placeUnassociatedMedia skips media already associated with a day or an item", () => {
  const days = [
    builderDay(1, { photos: [{ src: "u1", alt: "a", media_id: "m1" }] }),
    builderDay(2, { items: [item({ id: 1, time: "09:00", photos: [{ src: "u2", alt: "b", media_id: "m2" }] })] }),
  ];
  const media = [
    { media_id: "m1", url: "u1" },
    { media_id: "m2", url: "u2" },
    { media_id: "m3", url: "u3" },
  ];

  const placed = placeUnassociatedMedia(days, media, {});

  assert.deepEqual(placed[0].photos.map((photo) => photo.media_id), ["m3", "m1"]);
  assert.equal(placed[1].photos.length, 0);
});

test("placeUnassociatedMedia falls back to day 1 when the pending day no longer exists", () => {
  // The pending stash remembers day 3 but the day was deleted before a
  // save — the photo still has to surface somewhere rather than vanish.
  const placed = placeUnassociatedMedia([builderDay(1)], [{ media_id: "m1", url: "u1" }], { m1: 5 });

  assert.equal(placed[0].photos[0]?.media_id, "m1");
});

test("removing a persisted item photo also clears it from the canonical day state", () => {
  const days = [
    builderDay(1, {
      items: [item({
        id: 7,
        time: "09:00",
        photos: [
          { src: "target.jpg", alt: "Target", media_id: "m1" },
          { src: "keep.jpg", alt: "Keep", media_id: "m2" },
        ],
      })],
    }),
    builderDay(2, {
      items: [item({ id: 8, time: "10:00", photos: [{ src: "other.jpg", alt: "Other", media_id: "m3" }] })],
    }),
  ];

  const updated = removeItemPhotoFromDays(days, 7, "m1");

  assert.deepEqual(updated[0].items[0].photos?.map((photo) => photo.media_id), ["m2"]);
  assert.deepEqual(updated[1].items[0].photos?.map((photo) => photo.media_id), ["m3"]);
});

test("flightForItem resolves details for a flight added via Add Stop, which never lands in pkg.flights", () => {
  // Regression: the editor mapped the Nth FLIGHT item to flights[N] of the
  // package. A flight added via "+ Add Stop" isn't in that array, so it
  // resolved to undefined — no details, no edit affordance — and a flight
  // inserted ahead of a package flight shifted every later card onto the
  // wrong record.
  const flight = flightForItem(item({
    id: 1001,
    time: "09:30",
    type: "FLIGHT",
    title: "SYD to HND",
    price: "$850",
    icon: "plane",
    originIata: "SYD",
    destinationIata: "HND",
    airline: "Qantas",
    flightNumber: "QF25",
    cabinClass: "economy",
    departureDatetime: "2026-03-01T09:30:00+11:00",
    arrivalDatetime: "2026-03-01T17:00:00+09:00",
  }));

  assert.equal(flight?.airline, "Qantas");
  assert.equal(flight?.flight_number, "QF25");
  assert.equal(flight?.origin_iata, "SYD");
  assert.equal(flight?.destination_iata, "HND");
});

test("flightForItem returns undefined for non-flight items", () => {
  assert.equal(flightForItem(item({ id: 2, time: "10:00", type: "ACTIVITY" })), undefined);
});

test("the editor resolves flight details from the item, never a positional flights[N] lookup", () => {
  // Same regression guard as above, at the render site: indexing into
  // packageDetail.flights by item position is what made added flights
  // uneditable and mislabelled the rest.
  const source = readFileSync(new URL("./itinerary-editor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /flights\[flightIndex\]|flights\[flightIdx\]/);
});

test("an activity starting before the arrival flight lands gets a warning on its card", () => {
  // Singapore case: the museum was booked for 10:00 but the flight lands at 16:45.
  const items = [
    { id: 1, time: "07:00", type: "FLIGHT", title: "SYD to SIN", price: "$0", icon: "plane", status: "pass" },
    { id: 2, time: "10:00", type: "ACTIVITY", title: "Museum", price: "$0", icon: "star", status: "pass", duration: "60" },
    { id: 3, time: "18:30", type: "ACTIVITY", title: "Night market", price: "$0", icon: "star", status: "pass", duration: "60" },
  ] as TimelineItem[];
  const [, museum, market] = annotateItems(items, { time: "16:45", bufferMin: 90, international: true });
  assert.equal(museum.status, "critical");
  assert.equal(museum.problem, "Starts before your flight lands");
  assert.match(museum.problemDetail ?? "", /16:45/);
  assert.equal(market.problem, undefined);
});

test("without a landing time, activities aren't flagged for it", () => {
  const items = [
    { id: 2, time: "10:00", type: "ACTIVITY", title: "Museum", price: "$0", icon: "star", status: "pass", duration: "60" },
  ] as TimelineItem[];
  assert.equal(annotateItems(items)[0].problem, undefined);
});

test("a short gap between two stops says which trip there isn't enough time for", () => {
  const items = [
    { id: 1, time: "09:00", type: "ACTIVITY", title: "Grand Palace", price: "$0", icon: "star", status: "pass", duration: "60" },
    { id: 2, time: "10:05", type: "ACTIVITY", title: "Wat Arun", price: "$0", icon: "star", status: "pass", duration: "60" },
  ] as TimelineItem[];
  const [palace] = annotateItems(items);
  assert.equal(palace.problem, "Not enough travel time");
  assert.match(palace.problemDetail ?? "", /Only 5 min to get from "Grand Palace" to "Wat Arun"/);
});

test("the first activity too soon after landing gets a card warning with the earliest start", () => {
  // Was a blocking feasibility error (R2): lands 18:31, night market at 20:00 — 89 min.
  const items = [
    { id: 1, time: "13:00", type: "FLIGHT", title: "SYD to BKK", price: "$0", icon: "plane", status: "pass" },
    { id: 2, time: "20:00", type: "ACTIVITY", title: "Night Market", price: "$0", icon: "star", status: "pass", duration: "120" },
  ] as TimelineItem[];
  const [, market] = annotateItems(items, { time: "18:31", bufferMin: 90, international: true });
  assert.equal(market.status, "critical");
  assert.equal(market.problem, "Too soon after landing");
  assert.match(market.problemDetail ?? "", /18:31/);
  assert.match(market.problemDetail ?? "", /90 min/);
  assert.match(market.problemDetail ?? "", /20:01/);
});

test("only the first activity after landing is checked against the buffer", () => {
  const items = [
    { id: 2, time: "20:00", type: "ACTIVITY", title: "Dinner", price: "$0", icon: "star", status: "pass", duration: "60" },
    { id: 3, time: "21:30", type: "ACTIVITY", title: "Rooftop bar", price: "$0", icon: "star", status: "pass", duration: "60" },
  ] as TimelineItem[];
  const [, bar] = annotateItems(items, { time: "18:31", bufferMin: 90, international: true });
  assert.equal(bar.problem, undefined);
});

test("an activity starting after the full buffer is fine", () => {
  const items = [
    { id: 2, time: "20:01", type: "ACTIVITY", title: "Night Market", price: "$0", icon: "star", status: "pass", duration: "60" },
  ] as TimelineItem[];
  assert.equal(annotateItems(items, { time: "18:31", bufferMin: 90, international: true })[0].problem, undefined);
});

test("on a day before the arrival flight lands, every stop gets the before-landing warning", () => {
  const items = [
    { id: 1, time: "09:09", type: "ACTIVITY", title: "Museum", price: "$0", icon: "star", status: "pass", duration: "258" },
    { id: 2, time: "15:00", type: "FLIGHT", title: "SYD to BKK", price: "$0", icon: "plane", status: "pass" },
  ] as TimelineItem[];
  const [museum, flight] = annotateItems(items, { time: "00:31", departureTime: "15:00", bufferMin: 90, international: true, landsOnLaterDay: 2 });
  assert.equal(museum.problem, "Starts before your flight lands");
  assert.equal(museum.problemDetail, "Your flight leaves at 15:00 and lands at 00:31 the next day (Day 2), so you're still travelling. Move this to after you arrive.");
  assert.notEqual(flight.problem, "Starts before your flight lands");
});

test("a creator pick needs both a title and a description before it can be added or saved", () => {
  assert.equal(isCreatorPickComplete({ title: "Sunset at Sanur Beach Warung", description: "Grilled seafood on the sand." }), true);
  assert.equal(isCreatorPickComplete({ title: "Sunset at Sanur Beach Warung", description: "" }), false);
  assert.equal(isCreatorPickComplete({ title: "Sunset at Sanur Beach Warung", description: "   \n " }), false, "whitespace isn't a description");
  assert.equal(isCreatorPickComplete({ title: " ", description: "Grilled seafood on the sand." }), false);
});

test("both creator pick forms label the field Description and gate their button on it", () => {
  const source = readFileSync(new URL("./itinerary-editor.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes("<span>Why you recommend it</span>"), "add form still says \"Why you recommend it\"");
  assert.match(source, /disabled=\{!isCreatorPickComplete\(\{ title: p\.creatorDraft\.title, description: p\.creatorDraft\.reason \}\)\}[^>]*>Add creator pick/);
  assert.match(source, /<label className="edit-notes"><span>Description<RequiredMark \/><\/span>/);
  assert.match(source, /isFixedActivity \? !editingItem\.title\.trim\(\) : !isCreatorPickComplete\(\{ title: editingItem\.title, description: editingItem\.notes \}\)/);
});

test("creator pick title and description are marked required, visually and for screen readers", () => {
  const source = readFileSync(new URL("./itinerary-editor.tsx", import.meta.url), "utf8");
  for (const label of ["<span>Title<RequiredMark /></span>", "<span>Activity<RequiredMark /></span>"]) assert.ok(source.includes(label), label);
  assert.equal(source.split("<span>Description<RequiredMark /></span>").length - 1, 2, "both Description labels");
  assert.equal(source.split('aria-required="true"').length - 1, 4, "title and description inputs in both forms");
});
