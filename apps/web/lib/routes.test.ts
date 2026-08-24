import assert from "node:assert/strict";
import test from "node:test";

import { APP_ROUTES, routeFor } from "./routes";

test("every migrated screen has a stable absolute route", () => {
  assert.deepEqual(APP_ROUTES, {
    login: "/login",
    marketplace: "/marketplace",
    dashboard: "/dashboard",
    builder: "/packages/new",
    wizard: "/packages/new/ai",
    editor: "/packages/editor",
  });
  assert.equal(routeFor("editor"), "/packages/editor");
});
