import assert from "node:assert/strict";
import test from "node:test";

import {
  feasibilityStorageKey,
  parseStashedFeasibility,
  parseSubmittedFeasibility,
  toSubmittedFeasibility,
} from "./feasibility-result";

const issue = { error_code: "EMPTY_DAY", rule: "R9", severity: "warning" as const, field: "Day 5", affected_item: "Day 5", message: "No activities.", action: "Add one." };

test("toSubmittedFeasibility keeps the result's issues and score and stamps when it was checked", () => {
  const result = { is_feasible: true, hard_errors: [], soft_warnings: [issue], quality_score: 84 };
  const out = toSubmittedFeasibility(result, Date.UTC(2026, 9, 8, 4, 22));
  assert.equal(out?.quality_score, 84);
  assert.deepEqual(out?.soft_warnings, [issue]);
  assert.equal(out?.checked_at, "2026-10-08T04:22:00.000Z");
  assert.equal(toSubmittedFeasibility(null, 1), null);
  assert.equal(toSubmittedFeasibility({ ...result, quality_score: undefined }, 1)?.quality_score, null);
});

test("a stored result round-trips through the defensive parser", () => {
  const stored = toSubmittedFeasibility({ is_feasible: true, hard_errors: [], soft_warnings: [issue], quality_score: 84 }, 1);
  assert.deepEqual(parseSubmittedFeasibility(JSON.parse(JSON.stringify(stored))), stored);
});

test("malformed results read as nothing recorded instead of throwing", () => {
  for (const bad of [null, undefined, "x", 5, [], {}, { hard_errors: [] }, { hard_errors: "no", soft_warnings: [] }]) {
    assert.equal(parseSubmittedFeasibility(bad), null, String(JSON.stringify(bad)));
  }
  assert.equal(parseStashedFeasibility(null), null);
  assert.equal(parseStashedFeasibility("{not json"), null);
});

test("the parser drops unusable issues and ignores a non-numeric score", () => {
  const parsed = parseSubmittedFeasibility({
    quality_score: "high",
    is_feasible: "yes",
    hard_errors: [{ message: "no item" }, null],
    soft_warnings: [{ message: "ok", affected_item: "Day 2", severity: "nonsense" }],
  });
  assert.equal(parsed?.quality_score, null);
  assert.equal(parsed?.is_feasible, false);
  assert.deepEqual(parsed?.hard_errors, []);
  assert.equal(parsed?.soft_warnings[0].severity, "warning");
  assert.equal(parsed?.checked_at, "");
});

test("the stash key is per package", () => {
  assert.equal(feasibilityStorageKey("p1"), "package-feasibility:p1");
});
