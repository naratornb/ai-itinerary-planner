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

  assert.deepEqual(assignDayImages(3, media), [
    "first.jpg",
    "second.jpg",
    null,
  ]);
});

test("assignDayImages leaves empty slots null instead of plastering one photo everywhere", () => {
  // Regression: every photo-less slot used to fall back to the same stock
  // image, so a package with no photos rendered the identical picture on the
  // hero, every day card, and every stop.
  assert.deepEqual(assignDayImages(1, undefined), [null]);
});

test("assignDayImages prefers media_url over url", () => {
  const media = [{ url: "url.jpg", media_url: "media-url.jpg", sort_order: 0 }];
  assert.deepEqual(assignDayImages(1, media), ["media-url.jpg"]);
});

test("buildStopImages gives the first item up to 6 photos, the rest one each", () => {
  const media = Array.from({ length: 9 }, (_, i) => ({ url: `p${i + 1}.jpg`, sort_order: i + 1 }));
  const result = buildStopImages(4, media);
  assert.deepEqual(result[0], ["p1.jpg", "p2.jpg", "p3.jpg", "p4.jpg", "p5.jpg", "p6.jpg"]);
  assert.deepEqual(result[1], ["p7.jpg"]);
  assert.deepEqual(result[2], ["p8.jpg"]);
  assert.deepEqual(result[3], ["p9.jpg"]);
});

test("buildStopImages leaves items photoless once the pool runs out", () => {
  const media = [{ url: "only.jpg", sort_order: 1 }];
  const result = buildStopImages(3, media);
  assert.deepEqual(result, [["only.jpg"], [], []]);
});

test("initials derives up to two uppercase letters from a name", () => {
  assert.equal(initials("Elena Rossi"), "ER");
  assert.equal(initials("Madonna"), "M");
  assert.equal(initials(""), "?");
});
