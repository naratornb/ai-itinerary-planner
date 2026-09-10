import assert from "node:assert/strict";
import test from "node:test";

import { wizardDraftToPackageInput } from "../components/migrated-screens";

const draft = (overrides: Partial<Parameters<typeof wizardDraftToPackageInput>[0]> = {}) => ({
  destination: "Tokyo, Japan",
  vibes: ["food"],
  duration: "short" as const,
  customDurationDays: 5,
  season: "spring",
  ...overrides,
});

test("splits destination on the last comma", () => {
  const input = wizardDraftToPackageInput(draft());
  assert.equal(input.destination_city, "Tokyo");
  assert.equal(input.destination_country, "Japan");
});

test("splits on the LAST comma when several are present", () => {
  const input = wizardDraftToPackageInput(draft({ destination: "Paris, Texas, USA" }));
  assert.equal(input.destination_city, "Paris, Texas");
  assert.equal(input.destination_country, "USA");
});

test("single-word destination fills both city and country", () => {
  const input = wizardDraftToPackageInput(draft({ destination: "Iceland" }));
  assert.equal(input.destination_city, "Iceland");
  assert.equal(input.destination_country, "Iceland");
});

test("maps preset durations to days", () => {
  assert.equal(wizardDraftToPackageInput(draft({ duration: "short" })).duration_days, 4);
  assert.equal(wizardDraftToPackageInput(draft({ duration: "mid" })).duration_days, 7);
  assert.equal(wizardDraftToPackageInput(draft({ duration: "long" })).duration_days, 12);
});

test("custom duration uses the supplied day count", () => {
  const input = wizardDraftToPackageInput(draft({ duration: "custom", customDurationDays: 9 }));
  assert.equal(input.duration_days, 9);
});

test("custom duration below one clamps to one", () => {
  for (const days of [0, -3]) {
    const input = wizardDraftToPackageInput(draft({ duration: "custom", customDurationDays: days }));
    assert.equal(input.duration_days, 1);
  }
});

test("title and description are non-empty and season-aware", () => {
  const input = wizardDraftToPackageInput(draft({ season: "autumn" }));
  assert.equal(input.title, "Tokyo, Japan trip");
  assert.ok(input.title.length <= 200);
  assert.ok(input.description && input.description.length > 0);
  assert.ok(input.description.includes("autumn"));
});

test("vibes land in the description, and an empty list still reads cleanly", () => {
  const withVibes = wizardDraftToPackageInput(draft({ vibes: ["Chill", "Luxury"] }));
  assert.ok(withVibes.description.includes("Chill, Luxury"));
  const noVibes = wizardDraftToPackageInput(draft({ vibes: [] }));
  assert.equal(noVibes.description, "AI-planned itinerary for spring.");
});

test("a destination that is only a comma-fragment never yields an empty city", () => {
  const input = wizardDraftToPackageInput(draft({ destination: ", Japan" }));
  assert.equal(input.destination_city, ", Japan");
  assert.equal(input.destination_country, "Japan");
});

test("long destinations keep the title within 200 characters", () => {
  const input = wizardDraftToPackageInput(draft({ destination: "x".repeat(300) }));
  assert.equal(input.title.length, 200);
});

test("price and group size use the wizard defaults", () => {
  const input = wizardDraftToPackageInput(draft());
  assert.equal(input.base_price_aud, 0);
  assert.equal(input.max_group_size, null);
});
