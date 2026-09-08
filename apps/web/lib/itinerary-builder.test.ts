import assert from "node:assert/strict";
import test from "node:test";

import {
  appendItemToDay,
  copilotSuggestionToTimelineItem,
  getEndTime,
  insertItemInDay,
  moveItemInDay,
  removeDay,
  updateItemInDay,
  type BuilderDay,
  type TimelineItem,
} from "./itinerary-builder";
import type { CopilotSuggestionV1 } from "./copilot";

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
