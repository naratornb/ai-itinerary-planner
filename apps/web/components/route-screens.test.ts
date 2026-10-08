import assert from "node:assert/strict";
import test from "node:test";

import { dashboardRouteDecision } from "./route-screens";

test("dashboard route sends administrators to the review dashboard", async () => {
  const fetcher: typeof fetch = async () => Response.json({
    data: [],
    meta: { total: 0, page: 1, per_page: 1, total_pages: 0 },
  });

  assert.equal(
    await dashboardRouteDecision(fetcher, "http://localhost:8000", "admin-token"),
    "/admin",
  );
});

test("dashboard route keeps creators in their workspace and signed-out users at login", async () => {
  const creatorFetcher: typeof fetch = async () =>
    Response.json({ message: "Administrator access required" }, { status: 403 });

  assert.equal(
    await dashboardRouteDecision(creatorFetcher, "http://localhost:8000", "creator-token"),
    "/dashboard",
  );
  assert.equal(
    await dashboardRouteDecision(creatorFetcher, "http://localhost:8000", null),
    "/login",
  );
});
