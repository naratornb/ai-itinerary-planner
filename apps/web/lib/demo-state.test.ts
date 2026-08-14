import assert from "node:assert/strict";
import test from "node:test";

import { parseDemoState } from "./demo-state";

test("invalid session data falls back safely", () => {
  assert.deepEqual(parseDemoState("not-json"), {
    hasBuiltTrip: false,
    wizardStep: 0,
  });
});

test("wizard step is clamped to the supported range", () => {
  assert.deepEqual(parseDemoState('{"hasBuiltTrip":true,"wizardStep":99}'), {
    hasBuiltTrip: true,
    wizardStep: 3,
  });
});
