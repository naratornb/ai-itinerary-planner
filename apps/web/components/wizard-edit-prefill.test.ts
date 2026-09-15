import assert from "node:assert/strict";
import test from "node:test";

import { durationBucketFromDays } from "./migrated-screens";

test("durationBucketFromDays maps a stored day count back to the matching wizard card", () => {
  assert.deepEqual(durationBucketFromDays(4), { duration: "short", customDurationDays: 4 });
  assert.deepEqual(durationBucketFromDays(7), { duration: "mid", customDurationDays: 7 });
  assert.deepEqual(durationBucketFromDays(12), { duration: "long", customDurationDays: 12 });
  assert.deepEqual(durationBucketFromDays(20), { duration: "custom", customDurationDays: 20 });
});

test("durationBucketFromDays falls back to a sane default for missing or too-short values", () => {
  assert.deepEqual(durationBucketFromDays(null), { duration: "short", customDurationDays: 7 });
  assert.deepEqual(durationBucketFromDays(undefined), { duration: "short", customDurationDays: 7 });
  assert.deepEqual(durationBucketFromDays(1), { duration: "short", customDurationDays: 7 });
});
