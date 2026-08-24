import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { formatHotelStarRating, HOTEL_OPTIONS } from "./hotel-catalog";

test("formats hotel ratings in English", () => {
  assert.equal(formatHotelStarRating(4), "★★★★☆ 4-star hotel");
});

test("fixed hotel choices provide complete local booking details", () => {
  assert.deepEqual(
    HOTEL_OPTIONS.map(({ name, room, price, starRating }) => ({ name, room, price, starRating })),
    [
      { name: "Shibuya Excel Hotel Tokyu", room: "Standard room", price: 720, starRating: 4 },
      { name: "Park Hyatt Tokyo", room: "Deluxe room", price: 1680, starRating: 5 },
      { name: "9h Capsule Hotel", room: "Shared room", price: 270, starRating: 2 },
    ],
  );

  assert.equal(new Set(HOTEL_OPTIONS.map(({ id }) => id)).size, 3);

  for (const hotel of HOTEL_OPTIONS) {
    assert.ok(hotel.address);
    assert.match(hotel.checkIn, /^\d{2}:\d{2}$/);
    assert.match(hotel.checkOut, /^\d{2}:\d{2}$/);
    assert.match(hotel.image, /^\/hotels\/.+\.jpg$/);
    assert.ok(hotel.imageAlt);
    assert.doesNotMatch(JSON.stringify(hotel), /\u2014/);
    assert.ok(
      existsSync(new URL(`../public${hotel.image}`, import.meta.url)),
      `missing local image for ${hotel.name}`,
    );
  }
});
