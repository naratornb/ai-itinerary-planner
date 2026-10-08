import assert from "node:assert/strict";
import test from "node:test";

import { CREATOR_DASHBOARD_TABS, creatorPackageMatchesTab } from "./migrated-screens";

test("creator dashboard includes a rejected package filter", () => {
  assert.deepEqual(CREATOR_DASHBOARD_TABS, [
    "All",
    "Approved",
    "Under review",
    "Rejected",
    "Drafts",
  ]);
});

test("rejected filter keeps only rejected packages", () => {
  assert.equal(creatorPackageMatchesTab("Rejected", "Rejected"), true);
  assert.equal(creatorPackageMatchesTab("Rejected", "Approved"), false);
  assert.equal(creatorPackageMatchesTab("Rejected", "Draft"), false);
});
