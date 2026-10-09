import assert from "node:assert/strict";
import test from "node:test";

import { parsePendingMediaDays, pendingMediaStorageKey } from "./pending-media";

test("pendingMediaStorageKey is scoped per package", () => {
  assert.equal(pendingMediaStorageKey("pkg-1"), "package-pending-day-media:pkg-1");
});

test("parsePendingMediaDays returns {} for missing or invalid data", () => {
  assert.deepEqual(parsePendingMediaDays(null), {});
  assert.deepEqual(parsePendingMediaDays("not-json"), {});
  assert.deepEqual(parsePendingMediaDays(JSON.stringify("a string")), {});
  assert.deepEqual(parsePendingMediaDays(JSON.stringify([1, 2])), {});
});

test("parsePendingMediaDays reads back a saved media_id to day_number map", () => {
  assert.deepEqual(
    parsePendingMediaDays(JSON.stringify({ m1: 3, m2: 1 })),
    { m1: 3, m2: 1 },
  );
});

test("parsePendingMediaDays drops entries that can't name a real day", () => {
  assert.deepEqual(
    parsePendingMediaDays(JSON.stringify({ m1: 3, m2: 0, m3: -1, m4: 1.5, m5: "2", m6: null })),
    { m1: 3 },
  );
});
