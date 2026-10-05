import assert from "node:assert/strict";
import test from "node:test";

import { VIBES, vibeLabelsFromTags } from "./vibes";

test("the wizard offers exactly six vibes", () => {
  assert.equal(VIBES.length, 6);
  assert.deepEqual(
    VIBES.map((v) => v.id),
    ["chill", "adventure", "luxury", "local", "foodie", "scenic"],
  );
});

test("vibe ids map to their wizard labels", () => {
  assert.deepEqual(vibeLabelsFromTags(["foodie", "local"]), ["Local Experience", "Foodie"]);
  assert.deepEqual(vibeLabelsFromTags(["scenic"]), ["Scenic"]);
});

test("labels come back in canonical VIBES order, not tag order", () => {
  assert.deepEqual(vibeLabelsFromTags(["foodie", "adventure", "luxury"]), ["Adventure", "Luxury", "Foodie"]);
});

test("engine theme keywords map to the same vibes (VIBE_TO_KEYWORD inverse)", () => {
  // Seeded packages carry the engine's theme words rather than vibe ids.
  assert.deepEqual(vibeLabelsFromTags(["food", "culture"]), ["Local Experience", "Foodie"]);
  assert.deepEqual(vibeLabelsFromTags(["adventure"]), ["Adventure"]);
});

test("non-vibe tags are ignored; nothing canonical means no labels", () => {
  assert.deepEqual(vibeLabelsFromTags(["city", "romance", "japan"]), []);
  assert.deepEqual(vibeLabelsFromTags(["food", "city"]), ["Foodie"]);
});

test("duplicate vibes collapse to one label", () => {
  assert.deepEqual(vibeLabelsFromTags(["foodie", "food"]), ["Foodie"]);
});

test("null/undefined/empty tags yield no labels", () => {
  assert.deepEqual(vibeLabelsFromTags(null), []);
  assert.deepEqual(vibeLabelsFromTags(undefined), []);
  assert.deepEqual(vibeLabelsFromTags([]), []);
});
