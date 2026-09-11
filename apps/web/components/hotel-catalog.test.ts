import assert from "node:assert/strict";
import test from "node:test";

import { formatHotelStarRating } from "./hotel-catalog";

test("formats hotel ratings in English", () => {
  assert.equal(formatHotelStarRating(4), "★★★★☆ 4-star hotel");
});
