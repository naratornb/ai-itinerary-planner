import assert from "node:assert/strict";
import test from "node:test";

import { assignDayImages, buildStopImages, formatTripLength, initials } from "./marketplace-detail";

test("formatTripLength renders nights as one less than days", () => {
  assert.equal(formatTripLength(3), "3 Days / 2 Nights");
  assert.equal(formatTripLength(1), "1 Day / 0 Nights");
});

test("formatTripLength returns null when duration is unknown", () => {
  assert.equal(formatTripLength(null), null);
});

test("assignDayImages maps sorted media to slots by index", () => {
  const media = [
    { url: "second.jpg", sort_order: 2 },
    { url: "first.jpg", sort_order: 1 },
  ];

  assert.deepEqual(assignDayImages(3, media, "fallback.jpg"), [
    "first.jpg",
    "second.jpg",
    "fallback.jpg",
  ]);
});

test("assignDayImages falls back when there is no media at all", () => {
  assert.deepEqual(assignDayImages(1, undefined, "fallback.jpg"), ["fallback.jpg"]);
});

test("assignDayImages prefers media_url over url", () => {
  const media = [{ url: "url.jpg", media_url: "media-url.jpg", sort_order: 0 }];
  assert.deepEqual(assignDayImages(1, media, "fallback.jpg"), ["media-url.jpg"]);
});

test("buildStopImages gives the first item up to 6 photos, the rest one each", () => {
  const media = Array.from({ length: 9 }, (_, i) => ({ url: `p${i + 1}.jpg`, sort_order: i + 1 }));
  const result = buildStopImages(4, media, "fallback.jpg");
  assert.deepEqual(result[0], ["p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg", "p5.jpg", "p6.jpg"]);
  assert.deepEqual(result[1], ["p7.jpg"]);
  assert.deepEqual(result[2], ["p8.jpg"]);
  assert.deepEqual(result[3], ["p9.jpg"]);
});

test("buildStopImages falls back per item once the pool runs out", () => {
  const media = [{ url: "only.jpg", sort_order: 1 }];
  const result = buildStopImages(3, media, "fallback.jpg");
  assert.deepEqual(result, [["only.jpg"], ["fallback.jpg"], ["fallback.jpg"]]);
});

test("initials derives up to two uppercase letters from a name", () => {
  assert.equal(initials("Elena Rossi"), "ER");
  assert.equal(initials("Madonna"), "M");
  assert.equal(initials(""), "?");
});
