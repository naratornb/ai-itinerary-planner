import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { parseDemoState } from "./demo-state";

test("invalid session data falls back safely", () => {
  assert.deepEqual(parseDemoState("not-json"), { wizardStep: 0 });
});

test("wizard step is clamped to the supported range", () => {
  assert.deepEqual(parseDemoState('{"wizardStep":99}'), { wizardStep: 3 });
});

// Hydration guard: the provider must not read sessionStorage in a useState
// initializer — server renders the default while the client renders the stored
// value, producing different first-render trees (hydration mismatch).
test("provider does not read storage inside a lazy state initializer", () => {
  const source = readFileSync(new URL("../components/demo-state.tsx", import.meta.url), "utf8");
  assert.ok(!/useState\(\(\)\s*=>[\s\S]{0,300}sessionStorage/.test(source));
});
