import assert from "node:assert/strict";
import test from "node:test";

import MarketplacePage from "../app/marketplace/page";

test("the marketplace route exports a page component", () => {
  assert.equal(typeof MarketplacePage, "function");
});
