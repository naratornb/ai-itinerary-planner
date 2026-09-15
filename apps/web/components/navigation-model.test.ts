import assert from "node:assert/strict";
import test from "node:test";

import { creatorDashboardBackLink } from "./navigation-model";

test("package creation links back to the creator dashboard", () => {
  assert.deepEqual(creatorDashboardBackLink, {
    label: "Back to dashboard",
    href: "/dashboard",
  });
});

test("dashboard action heading and buttons share the same centered alignment", async () => {
  const navigationModel = await import("./navigation-model");
  const alignment = (navigationModel as typeof navigationModel & {
    dashboardActionAlignment?: { header: string; buttons: string };
  }).dashboardActionAlignment;

  assert.deepEqual(alignment, { header: "center", buttons: "center" });
});
