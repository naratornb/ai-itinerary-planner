import assert from "node:assert/strict";
import test from "node:test";

import {
  appendItemToDay,
  buildDaysFromPackage,
  copilotSuggestionToTimelineItem,
  extractClockTimeInZone,
  getEndTime,
  insertItemInDay,
  moveItemInDay,
  removeDay,
  timezoneForIata,
  updateItemInDay,
  type BuilderDay,
  type TimelineItem,
} from "./itinerary-builder";
import type { CopilotSuggestionV1 } from "./copilot";
import type { CreatorPackageDetail } from "./creator-api";

const firstItem: TimelineItem = {
  id: 1,
  time: "09:00",
  type: "ACTIVITY",
  title: "Breakfast",
  price: "$20",
  icon: "star",
  status: "pass",
};

const secondItem: TimelineItem = {
  ...firstItem,
  id: 2,
  time: "11:00",
  title: "Museum",
};

function makeDays(): BuilderDay[] {
  return [
    { id: "day-1", day: 1, title: "Arrival", meta: "City", items: [firstItem], story: "", photos: [] },
    { id: "day-2", day: 2, title: "Culture", meta: "Museums", items: [secondItem], story: "", photos: [] },
  ];
}

test("appendItemToDay adds only to the requested day", () => {
  const nextItem = { ...secondItem, id: 3, title: "Dinner" };
  const result = appendItemToDay(makeDays(), "day-1", nextItem);

  assert.deepEqual(result[0].items.map((item) => item.title), ["Breakfast", "Dinner"]);
  assert.deepEqual(result[1].items.map((item) => item.title), ["Museum"]);
});

test("updateItemInDay updates an item without changing another day", () => {
  const result = updateItemInDay(makeDays(), "day-1", 1, { title: "Ramen breakfast" });

  assert.equal(result[0].items[0].title, "Ramen breakfast");
  assert.equal(result[1].items[0].title, "Museum");
});

test("insertItemInDay inserts after the given index without touching another day", () => {
  const result = insertItemInDay(makeDays(), "day-1", 0, { ...secondItem, id: 3 });

  assert.deepEqual(result[0].items.map((item) => item.id), [1, 3]);
  assert.deepEqual(result[1].items.map((item) => item.id), [2]);
});

test("moveItemInDay reorders only the requested day", () => {
  const days = appendItemToDay(makeDays(), "day-1", { ...secondItem, id: 3 });
  const result = moveItemInDay(days, "day-1", 1, 0);

  assert.deepEqual(result[0].items.map((item) => item.id), [3, 1]);
  assert.deepEqual(result[1].items.map((item) => item.id), [2]);
});

test("removeDay renumbers remaining days and preserves their items", () => {
  const result = removeDay(makeDays(), "day-1");

  assert.equal(result.length, 1);
  assert.equal(result[0].day, 1);
  assert.equal(result[0].id, "day-2");
  assert.deepEqual(result[0].items.map((item) => item.id), [2]);
});

test("getEndTime adds duration minutes and wraps past midnight", () => {
  assert.equal(getEndTime("09:00", "90"), "10:30");
  assert.equal(getEndTime("23:30", "90"), "01:00");
});

const foodSuggestion: CopilotSuggestionV1 = {
  item_id: "AC-NRT-001",
  item_name: "Tokyo Street Food Walking Tour",
  item_type: "activity",
  city: "Tokyo",
  country: "Japan",
  category: "food",
  vibe: "Local, lively",
  best_season: "Spring",
  suitable_for: "Foodies",
  duration_hours: 3.6,
  price_aud: 144,
  rating: 4.5,
  why_recommended: "Matches your interest in local food.",
  verified: true,
  confidence: 0.95,
};

test("copilotSuggestionToTimelineItem maps suggestion fields onto a timeline item", () => {
  const item = copilotSuggestionToTimelineItem(foodSuggestion, 42, []);

  assert.equal(item.id, 42);
  assert.equal(item.title, "Tokyo Street Food Walking Tour");
  assert.equal(item.type, "ACTIVITY");
  assert.equal(item.icon, "star");
  assert.equal(item.price, "$144");
  assert.equal(item.duration, "216");
  assert.equal(item.category, "food");
  assert.equal(item.notes, "Matches your interest in local food.");
  assert.equal(item.sourceId, "AC-NRT-001");
  assert.equal(item.status, "pass");
  assert.equal(item.time, "09:00");
});

test("copilotSuggestionToTimelineItem starts right after the day's last item", () => {
  const previousItem: TimelineItem = { ...firstItem, time: "09:00", duration: "20" };

  const item = copilotSuggestionToTimelineItem(
    { ...foodSuggestion, item_type: "hotel", item_id: "HT-001" },
    43,
    [previousItem],
  );

  assert.equal(item.time, "09:20");
  assert.equal(item.type, "HOTEL");
  assert.equal(item.icon, "hotel");
});

test("a flight lands on its arrival day, at its arrival time in the destination's zone", () => {
  // Departure and arrival fall on different UTC calendar days on purpose —
  // the flight must key off arrival, not departure, for both its day and
  // its displayed clock time, so it lines up with that day's Tokyo activity.
  const pkg: CreatorPackageDetail = {
    package_id: "pkg-1",
    title: "Tokyo Street Food & Culture Week",
    duration_days: 2,
    days: [],
    hotels: [],
    activities: [
      {
        activity_id: "act-1",
        sequence_order: 1,
        activity_name: "Tokyo Cooking Class",
        activity_date: "2026-07-12",
        city: "Tokyo",
        duration_hours: 3,
        price_aud: 128,
        description: null,
        booking_required: null,
      },
    ],
    flights: [
      {
        flight_id: "fl-1",
        airline: "Qantas",
        flight_number: "QF25",
        origin_iata: "SYD",
        destination_iata: "NRT",
        departure_datetime: "2026-07-10T20:00:00Z",
        // JST (UTC+9, no DST in Japan) — lands 14:00 local on July 12, a day
        // after it departed.
        arrival_datetime: "2026-07-12T05:00:00Z",
        cabin_class: null,
        price_aud: 850,
      },
    ],
  };

  const days = buildDaysFromPackage(pkg);

  assert.equal(days[0].items.length, 0);
  const flightItem = days[1].items.find((item) => item.type === "FLIGHT");
  assert.equal(flightItem?.time, "14:00");
});

test("extractClockTimeInZone renders a flight's real instant in the given zone, not a raw ISO substring", () => {
  // Stored with a +14:00 offset: the digits right after "T" ("08:00") match
  // neither Sydney's nor Tokyo's clock — only a real zone-aware conversion
  // of the underlying UTC instant (2026-04-01T18:00:00Z) does.
  const instant = "2026-04-02T08:00:00+14:00";

  assert.equal(extractClockTimeInZone(instant, "Australia/Sydney"), "05:00");
  assert.equal(extractClockTimeInZone(instant, "Asia/Tokyo"), "03:00");
});

test("timezoneForIata knows Sydney and Tokyo, and falls back to Sydney for an unknown code", () => {
  assert.equal(timezoneForIata("SYD"), "Australia/Sydney");
  assert.equal(timezoneForIata("NRT"), "Asia/Tokyo");
  assert.equal(timezoneForIata("XXX"), "Australia/Sydney");
  assert.equal(timezoneForIata(null), "Australia/Sydney");
});
