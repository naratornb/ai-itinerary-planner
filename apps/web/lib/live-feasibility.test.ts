import assert from "node:assert/strict";
import test from "node:test";

import { applyLiveFixes, baselineOf, issueKey, liveView, localChecks } from "./live-feasibility";

const issue = (error_code: string, affected_item = "Entire Package", field = "") => ({
  error_code,
  rule: error_code,
  severity: "error" as const,
  field,
  field_value: "",
  affected_item,
  message: error_code,
  action: "",
});

test("issueKey identifies an issue by code, item and field", () => {
  assert.equal(issueKey(issue("MISSING_PHOTOS")), "MISSING_PHOTOS|Entire Package|");
  assert.notEqual(issueKey(issue("EMPTY_DAY", "Day 1", "day_1")), issueKey(issue("EMPTY_DAY", "Day 2", "day_2")));
});

test("localChecks reports missing photos and clears it once a photo exists", () => {
  const empty = { days_json: "[]", photo_count: 0 };
  assert.ok(localChecks(empty).hard.some((i) => i.error_code === "MISSING_PHOTOS"));
  assert.ok(!localChecks({ ...empty, photo_count: 1 }).hard.some((i) => i.error_code === "MISSING_PHOTOS"));
});

test("localChecks tolerates unparseable days", () => {
  assert.ok(Array.isArray(localChecks({ days_json: "{nope", photo_count: 0 }).hard));
});

test("a critical issue the deterministic rules no longer report disappears immediately", () => {
  const photos = issue("MISSING_PHOTOS");
  const baseline = baselineOf({ hard: [photos], soft: [] }).hard;
  assert.deepEqual(applyLiveFixes([photos], baseline, []), []);
});

test("an issue that is still present stays, and a newly introduced one appears", () => {
  const photos = issue("MISSING_PHOTOS");
  const overlap = issue("TIME_OVERLAP", "Day 2 – Museum", "day_2");
  const baseline = baselineOf({ hard: [photos], soft: [] }).hard;

  assert.deepEqual(applyLiveFixes([photos], baseline, [photos]), [photos], "unfixed stays");
  const result = applyLiveFixes([photos], baseline, [photos, overlap]);
  assert.deepEqual(result.map((i) => i.error_code), ["MISSING_PHOTOS", "TIME_OVERLAP"]);
});

test("an issue still present after an edit shows its current details, not the ones from the last check", () => {
  // Regression: moving Lunch 11:00 → 11:30 still overlaps Museum, but the panel kept saying "starts at 11:00".
  const payload = (lunch: string) => ({ photo_count: 1, days_json: JSON.stringify([{
    day_number: 1, has_accommodation: true, flights: [], activities: [
      { activity_name: "Museum", start_time: "10:00", duration_hours: 2, price: "$10" },
      { activity_name: "Lunch", start_time: lunch, duration_hours: 1, price: "$20" },
    ],
  }]) });
  const checked = localChecks(payload("11:00"));
  const travel = issue("SHORT_TRAVEL_TIME", "Lunch", "Day 1");
  const result = { hard_errors: [...checked.hard, travel], soft_warnings: checked.soft };

  const now = localChecks(payload("11:30"));
  const view = liveView(result, baselineOf(checked), now);
  const overlap = view.hardErrors.find((i) => i.error_code === "TIME_OVERLAP");
  assert.equal(overlap, now.hard.find((i) => i.error_code === "TIME_OVERLAP"));
  assert.match(overlap?.message ?? "", /starts at 11:30/);
  assert.equal(view.hardErrors.find((i) => i.error_code === "SHORT_TRAVEL_TIME"), travel, "travel-time finding untouched");
});

test("issues sharing a key are each replaced once, never duplicated", () => {
  const old = [{ ...issue("TIME_OVERLAP", "Lunch", "Day 1"), message: "a" }, { ...issue("TIME_OVERLAP", "Lunch", "Day 1"), message: "b" }];
  const now = [{ ...old[0], message: "a2" }, { ...old[1], message: "b2" }];
  const result = applyLiveFixes(old, baselineOf({ hard: old, soft: [] }).hard, now);
  assert.deepEqual(result.map((i) => i.message), ["a2", "b2"]);
  const grown = applyLiveFixes(old.slice(0, 1), baselineOf({ hard: old.slice(0, 1), soft: [] }).hard, now);
  assert.deepEqual(grown.map((i) => i.message), ["a2", "b2"], "a second copy of an existing issue appears");
});

test("findings the deterministic rules never reported are left exactly as the server returned them", () => {
  const ai = issue("AI_OPENING_HOURS", "Day 1 – Temple", "day_1");
  const brand = issue("POLICY_VIOLATION", "Entire Package");
  const photos = issue("MISSING_PHOTOS");
  const baseline = baselineOf({ hard: [photos], soft: [] }).hard;

  const result = applyLiveFixes([ai, brand, photos], baseline, []);
  assert.deepEqual(result, [ai, brand], "AI and policy findings survive; only the fixed photo issue goes");
});

test("an issue reappears when an edit undoes the fix", () => {
  const photos = issue("MISSING_PHOTOS");
  const baseline = baselineOf({ hard: [photos], soft: [] }).hard;
  assert.equal(applyLiveFixes([photos], baseline, []).length, 0);
  assert.equal(applyLiveFixes([photos], baseline, [photos]).length, 1);
});

test("liveView: fixing the only critical issue clears it and flags that a re-check is needed", () => {
  const photos = issue("MISSING_PHOTOS");
  const result = { hard_errors: [photos], soft_warnings: [] };
  const baseline = baselineOf({ hard: [photos], soft: [] });

  const before = liveView(result, baseline, { hard: [photos], soft: [] });
  assert.equal(before.hardErrors.length, 1);
  assert.equal(before.criticalFixedLive, false);

  const after = liveView(result, baseline, { hard: [], soft: [] });
  assert.equal(after.hardErrors.length, 0);
  assert.equal(after.criticalFixedLive, true);
});

test("liveView: an AI critical issue keeps the panel critical even when the local one is fixed", () => {
  const photos = issue("MISSING_PHOTOS");
  const ai = issue("AI_OPENING_HOURS", "Day 1 – Temple", "day_1");
  const result = { hard_errors: [ai, photos], soft_warnings: [] };
  const view = liveView(result, baselineOf({ hard: [photos], soft: [] }), { hard: [], soft: [] });
  assert.deepEqual(view.hardErrors, [ai]);
  assert.equal(view.criticalFixedLive, false);
});

test("liveView: with no edits the panel equals the server result", () => {
  const warn = issue("SHORT_ACTIVITY_GAP", "Day 2", "day_2");
  const result = { hard_errors: [], soft_warnings: [warn] };
  const view = liveView(result, baselineOf({ hard: [], soft: [warn] }), { hard: [], soft: [warn] });
  assert.deepEqual(view.softWarnings, [warn]);
  assert.equal(view.criticalFixedLive, false);
});

test("liveView: without a baseline (or result) it falls back to the server data untouched", () => {
  assert.deepEqual(liveView(null, null, null), { hardErrors: [], softWarnings: [], criticalFixedLive: false });
  const photos = issue("MISSING_PHOTOS");
  const view = liveView({ hard_errors: [photos], soft_warnings: [] }, null, { hard: [], soft: [] });
  assert.deepEqual(view.hardErrors, [photos]);
});
