import assert from "node:assert/strict";
import test from "node:test";

import { parseDemoState } from "./demo-state";

test("invalid session data falls back safely", () => {
  assert.deepEqual(parseDemoState("not-json"), { wizardStep: 0 });
});

test("wizard step is clamped to the supported range", () => {
  assert.deepEqual(parseDemoState('{"wizardStep":99}'), { wizardStep: 3 });
});
