import assert from "node:assert/strict";
import test from "node:test";

import {
  adminApprovalRoute,
  APP_ROUTES,
  creatorPackageRoute,
  creatorPackageShareRoute,
  creatorPreviewBack,
  routeFor,
} from "./routes";

test("every migrated screen has a stable absolute route", () => {
  assert.deepEqual(APP_ROUTES, {
    login: "/login",
    marketplace: "/marketplace",
    dashboard: "/dashboard",
    admin: "/admin",
    builder: "/packages/new",
    manualBuilder: "/packages/new/manual",
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

test("only a live package has a public share route", () => {
  assert.equal(
    creatorPackageShareRoute("package/1", "live"),
    "/marketplace/packages/package%2F1",
  );
  assert.equal(creatorPackageShareRoute("package-1", "approved"), null);
  assert.equal(creatorPackageShareRoute("package-1", "draft"), null);
});

test("a package that is neither approved nor live opens in the editor", () => {
  assert.equal(creatorPackageRoute("package-1", "draft"), "/packages/editor/package-1");
  assert.equal(creatorPackageRoute("package-1", "pending_review"), "/packages/editor/package-1");
  assert.equal(creatorPackageRoute("package-1", "rejected"), "/packages/editor/package-1");
});

test("an administrator review path encodes the package id", () => {
  assert.equal(adminApprovalRoute("package/id"), "/admin/approvals/package%2Fid");
});

test("a preview opened from the editor goes back to the editor, one opened from the dashboard goes back there", () => {
  // Drafts and rejected packages are previewed from the editor.
  assert.deepEqual(creatorPreviewBack("pkg/1", "draft"), { href: "/packages/editor/pkg%2F1", label: "Back to editor" });
  assert.deepEqual(creatorPreviewBack("pkg-2", "rejected"), { href: "/packages/editor/pkg-2", label: "Back to editor" });
  // An approved package is previewed from its dashboard row.
  assert.deepEqual(creatorPreviewBack("pkg-3", "approved"), { href: "/dashboard", label: "Back to dashboard" });
  for (const status of ["pending_review", "live", "", null, undefined]) {
    assert.equal(creatorPreviewBack("pkg-4", status).href, "/dashboard", String(status));
  }
});
