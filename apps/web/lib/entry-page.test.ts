import assert from "node:assert/strict";
import test from "node:test";

import Home from "../app/page";

test("the root page redirects to the marketplace", () => {
  assert.throws(Home, (error: unknown) => {
    return (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String(error.digest).includes("/marketplace")
    );
  });
});
