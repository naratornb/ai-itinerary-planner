import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("the Co-Pilot trigger stays fixed in its original lower-right position", () => {
  const rule = styles.match(/\.copilot-mobile-trigger\s*\{[^}]*\}/)?.[0] ?? "";

  assert.match(rule, /position:\s*fixed/);
  assert.match(rule, /right:\s*max\(/);
  assert.match(rule, /bottom:\s*24px/);
});

test("editor guidance appears in the lower-left corner away from Co-Pilot", () => {
  const rule = styles.match(/\.editor-toast\s*\{[^}]*\}/)?.[0] ?? "";

  assert.match(rule, /position:\s*fixed/);
  assert.match(rule, /left:\s*24px/);
  assert.match(rule, /bottom:\s*24px/);
  assert.doesNotMatch(rule, /right:/);
});
