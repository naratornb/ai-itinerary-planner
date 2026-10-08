import assert from "node:assert/strict";
import test from "node:test";

import { CREATOR_DASHBOARD_TABS, creatorPackageMatchesTab } from "./migrated-screens";

test("creator dashboard has a filter for every status the stats and rows can show", () => {
  assert.deepEqual(CREATOR_DASHBOARD_TABS, [
    "All",
    "Approved",
    "Live",
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

test("live filter keeps only published packages and All still shows them", () => {
  assert.equal(creatorPackageMatchesTab("Live", "Live"), true);
  assert.equal(creatorPackageMatchesTab("Live", "Approved"), false);
  assert.equal(creatorPackageMatchesTab("Approved", "Live"), false);
  assert.equal(creatorPackageMatchesTab("All", "Live"), true);
});
