import assert from "node:assert/strict";
import test from "node:test";

import { creatorNavigationItems } from "./navigation-model";

test("creator navigation uses route-based package links", () => {
  assert.equal(creatorNavigationItems[0]?.href, "/dashboard");
  assert.equal(creatorNavigationItems[1]?.href, "/packages/new");
});
