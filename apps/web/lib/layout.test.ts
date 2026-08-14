import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the root layout removes the browser body margin", () => {
  const source = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(source, /style=\{\{[\s\S]*?margin:\s*0/);
});
