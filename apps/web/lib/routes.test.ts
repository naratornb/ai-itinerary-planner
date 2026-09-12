import assert from "node:assert/strict";
import test from "node:test";

import { APP_ROUTES, creatorPackageRoute, routeFor } from "./routes";

test("every migrated screen has a stable absolute route", () => {
  assert.deepEqual(APP_ROUTES, {
    login: "/login",
    marketplace: "/marketplace",
    dashboard: "/dashboard",
    builder: "/packages/new",
    wizard: "/packages/new/ai",
  });
  assert.equal(routeFor("login"), APP_ROUTES.login);
});

test("an approved package opens its authenticated creator preview", () => {
  assert.equal(
    creatorPackageRoute("approved-package", "approved"),
    "/packages/preview/approved-package",
  );
});

test("a live package opens its public marketplace detail", () => {
  assert.equal(
    creatorPackageRoute("package/1", "live"),
    "/marketplace/packages/package%2F1",
  );
});

test("a package that is neither approved nor live opens in the editor", () => {
  assert.equal(creatorPackageRoute("package-1", "draft"), "/packages/editor/package-1");
  assert.equal(creatorPackageRoute("package-1", "pending_review"), "/packages/editor/package-1");
  assert.equal(creatorPackageRoute("package-1", "rejected"), "/packages/editor/package-1");
});
