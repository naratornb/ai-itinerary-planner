import assert from "node:assert/strict";
import test from "node:test";

import { formatTripLength, initials, planItineraryPhotos } from "./marketplace-detail";

test("formatTripLength renders nights as one less than days", () => {
  assert.equal(formatTripLength(3), "3 Days / 2 Nights");
  assert.equal(formatTripLength(1), "1 Day / 0 Nights");
});

test("formatTripLength returns null when duration is unknown", () => {
  assert.equal(formatTripLength(null), null);
});

test("with no links, uploads other than the cover become day headers once each, in order", () => {
  // Regression: the whole pool was re-spread from the start on every day, so a
  // 3-photo package showed the same pictures on all days and every first stop.
  const media = [
    { url: "second.jpg", sort_order: 2 },
    { url: "cover.jpg", sort_order: 1 },
    { url: "third.jpg", sort_order: 3 },
  ];
  const days = [{ items: [{}, {}] }, { items: [{}] }, { items: [] }, { items: [] }];
  const plan = planItineraryPhotos(days, media, "cover.jpg");

  assert.deepEqual(plan.dayImages, ["second.jpg", "third.jpg", null, null]);
  assert.deepEqual(plan.stopImages, [[[], []], [[]], [], []], "stops get no photo from an unlinked pool");
  assert.equal(new Set(plan.dayImages.filter(Boolean)).size, 2, "no photo is shown twice");
});

test("a package with only its cover shows no day photos instead of repeating the hero", () => {
  const plan = planItineraryPhotos([{ items: [{}] }, { items: [] }], [{ url: "cover.jpg" }], "cover.jpg");
  assert.deepEqual(plan.dayImages, [null, null]);
});

test("planItineraryPhotos prefers media_url over url and handles no media at all", () => {
  assert.deepEqual(
    planItineraryPhotos([{ items: [] }], [{ url: "url.jpg", media_url: "media-url.jpg" }], null).dayImages,
    ["media-url.jpg"],
  );
  assert.deepEqual(planItineraryPhotos([{ items: [] }, { items: [] }], undefined, null).dayImages, [null, null]);
});

test("linked photos are used where the creator placed them", () => {
  const days = [
    { photos: [{ src: "day1.jpg" }, { src: "day1b.jpg" }], items: [{ photos: [{ src: "walk.jpg" }, { src: "walk2.jpg" }] }, { photos: [] }] },
    { photos: [], items: [{ photos: [{ src: "food.jpg" }] }] },
  ];
  const plan = planItineraryPhotos(days, [{ url: "ignored.jpg" }], "cover.jpg");

  assert.deepEqual(plan.dayImages, ["day1.jpg", null], "a day header is its first photo; no stand-in when it has none");
  assert.deepEqual(plan.stopImages, [[["walk.jpg", "walk2.jpg"], []], [["food.jpg"]]]);
});

test("a hotel photo repeated on every night row, or reused as a day header, is shown once", () => {
  const night = (n: number) => ({ photos: [], items: [{ photos: [{ src: "hotel.jpg" }] }], n });
  const plan = planItineraryPhotos(
    [{ photos: [{ src: "hotel.jpg" }], items: [{ photos: [{ src: "hotel.jpg" }, { src: "lobby.jpg" }] }] }, night(2), night(3)],
    undefined,
    null,
  );
  assert.deepEqual(plan.dayImages, ["hotel.jpg", null, null]);
  assert.deepEqual(plan.stopImages, [[["lobby.jpg"]], [[]], [[]]]);
});

test("a stop shows at most six linked photos", () => {
  const photos = Array.from({ length: 9 }, (_, i) => ({ src: `p${i}.jpg` }));
  assert.equal(planItineraryPhotos([{ items: [{ photos }] }], undefined, null).stopImages[0][0].length, 6);
});

test("initials derives up to two uppercase letters from a name", () => {
  assert.equal(initials("Elena Rossi"), "ER");
  assert.equal(initials("Madonna"), "M");
  assert.equal(initials(""), "?");
});
