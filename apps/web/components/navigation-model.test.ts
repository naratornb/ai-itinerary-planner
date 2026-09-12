import assert from "node:assert/strict";
import test from "node:test";

import { creatorNavigationItems } from "./navigation-model";

test("creator navigation uses route-based package links", () => {
  assert.equal(creatorNavigationItems[0]?.href, "/dashboard");
  assert.equal(creatorNavigationItems[1]?.href, "/packages/new");
});

test("dashboard action heading and buttons share the same centered alignment", async () => {
  const navigationModel = await import("./navigation-model");
  const alignment = (navigationModel as typeof navigationModel & {
    dashboardActionAlignment?: { header: string; buttons: string };
  }).dashboardActionAlignment;

  assert.deepEqual(alignment, { header: "center", buttons: "center" });
});
