import assert from "node:assert/strict";
import test from "node:test";
import { formatHotelStarRating } from "./hotel-catalog";

test("formats hotel ratings in English", () => {
  assert.equal(formatHotelStarRating(4), "★★★★☆ 4-star hotel");
});

test("out-of-range ratings can't crash the card", () => {
  // repeat(-1) throws RangeError — bad catalog data would white-screen the picker.
  assert.equal(formatHotelStarRating(6), "★★★★★ 6-star hotel");
  assert.equal(formatHotelStarRating(0), "☆☆☆☆☆ 0-star hotel");
  assert.equal(formatHotelStarRating(4.5), "★★★★☆ 4.5-star hotel");
});
