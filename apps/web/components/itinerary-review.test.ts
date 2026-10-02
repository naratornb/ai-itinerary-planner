import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewDayUpdates } from "./itinerary-review";
import type { BuilderDay } from "../lib/itinerary-builder";

function day(overrides: Partial<BuilderDay> = {}): BuilderDay {
  return { id: "day-1", day: 1, title: "Day 1", meta: "", items: [], story: "", photos: [], ...overrides };
}

test("buildReviewDayUpdates keeps day photo associations and meta", () => {
  // Regression: the RPC upserts supplied day rows wholesale, so a payload
  // without media_ids/meta wrote them back empty — saving a draft from the
  // review page wiped every day's photos and meta.
  const updates = buildReviewDayUpdates([
    day({ meta: "food", photos: [{ src: "u1", alt: "a", media_id: "m1" }, { src: "u2", alt: "b", media_id: "m2" }] }),
  ]);

  assert.deepEqual(updates[0].media_ids, ["m1", "m2"]);
  assert.equal(updates[0].meta, "food");
});

test("buildReviewDayUpdates drops preview photos that never finished uploading", () => {
  const updates = buildReviewDayUpdates([
    day({ photos: [{ src: "blob:x", alt: "a" }, { src: "u1", alt: "b", media_id: "m1" }] }),
  ]);

  assert.deepEqual(updates[0].media_ids, ["m1"]);
});

test("buildReviewDayUpdates matches the editor's null/empty conventions", () => {
  const updates = buildReviewDayUpdates([day(), day({ day: 2, id: "day-2", title: "Markets" })]);

  assert.deepEqual(updates[0], { day_number: 1, title: null, summary: null, meta: null, media_ids: [] });
  assert.equal(updates[1].day_number, 2);
  assert.equal(updates[1].title, "Markets");
});
