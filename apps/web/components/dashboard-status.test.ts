import assert from "node:assert/strict";
import test from "node:test";

import { creatorPackageStatusStyle } from "./migrated-screens";

test("rejected packages use the red danger badge treatment", () => {
  assert.deepEqual(creatorPackageStatusStyle("rejected"), {
    color: "#D40119",
    background: "#FEE2E2",
  });
});
