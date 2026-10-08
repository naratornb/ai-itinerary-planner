import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REVIEW_DRAFT,
  parseItinerarySnapshot,
  parseReviewDraft,
  parseWizardVibesDraft,
} from "./review-draft";

test("parseReviewDraft falls back to the default for missing or invalid data", () => {
  assert.deepEqual(parseReviewDraft(null), DEFAULT_REVIEW_DRAFT);
  assert.deepEqual(parseReviewDraft("not-json"), DEFAULT_REVIEW_DRAFT);
  assert.deepEqual(parseReviewDraft("42"), DEFAULT_REVIEW_DRAFT);
});

test("parseReviewDraft reads back a saved draft", () => {
  assert.deepEqual(
    parseReviewDraft(JSON.stringify({ description: "A great trip.", coverMediaId: "media-1" })),
    { description: "A great trip.", coverMediaId: "media-1" },
  );
});

test("parseReviewDraft ignores fields of the wrong type", () => {
  assert.deepEqual(
    parseReviewDraft(JSON.stringify({ description: 42, coverMediaId: 7 })),
    DEFAULT_REVIEW_DRAFT,
  );
});

test("parseWizardVibesDraft returns null for missing or invalid data", () => {
  assert.equal(parseWizardVibesDraft(null), null);
  assert.equal(parseWizardVibesDraft("not-json"), null);
  assert.equal(parseWizardVibesDraft(JSON.stringify({ vibes: "not-an-array" })), null);
  assert.equal(parseWizardVibesDraft(JSON.stringify({ vibes: [1, 2] })), null);
});

test("parseWizardVibesDraft reads back the wizard's saved selection", () => {
  assert.deepEqual(
    parseWizardVibesDraft(JSON.stringify({ vibes: ["Chill", "Foodie"], season: "spring" })),
    { vibes: ["Chill", "Foodie"], season: "spring" },
  );
});

test("parseWizardVibesDraft defaults a missing season to null", () => {
  assert.deepEqual(
    parseWizardVibesDraft(JSON.stringify({ vibes: ["Chill"] })),
    { vibes: ["Chill"], season: null },
  );
});

test("parseItinerarySnapshot returns null for missing or invalid data", () => {
  assert.equal(parseItinerarySnapshot(null), null);
  assert.equal(parseItinerarySnapshot("not-json"), null);
  assert.equal(parseItinerarySnapshot(JSON.stringify({ title: "Trip" })), null);
  assert.equal(parseItinerarySnapshot(JSON.stringify({ days: [] })), null);
});

test("parseItinerarySnapshot reads back the editor's saved snapshot", () => {
  const days = [{ id: "day-1", day: 1, title: "Arrival", meta: "", items: [], story: "", photos: [] }];
  assert.deepEqual(
    parseItinerarySnapshot(JSON.stringify({ title: "Tokyo Trip", days })),
    { title: "Tokyo Trip", days },
  );
});
