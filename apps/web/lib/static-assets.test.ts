import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the creator banner PNG is served from the public directory", () => {
  const banner = readFileSync(
    new URL("../public/creator-banner.png", import.meta.url),
  );

  assert.deepEqual([...banner.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
