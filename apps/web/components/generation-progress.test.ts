import assert from "node:assert/strict";
import test from "node:test";

import * as screens from "./migrated-screens";

test("simulated generation reaches Finalising but never completes before the API", () => {
  const visualState = (screens as unknown as {
    generationVisualState?: (elapsedMs: number, complete: boolean) => { activeStep: number; progress: number };
  }).generationVisualState;

  assert.equal(typeof visualState, "function", "AI generation needs a time-based visual state");
  assert.deepEqual(visualState!(0, false), { activeStep: 0, progress: 0 });
  assert.deepEqual(visualState!(5_000, false), { activeStep: 1, progress: 30 });
  assert.deepEqual(visualState!(11_000, false), { activeStep: 2, progress: 55 });
  assert.deepEqual(visualState!(18_000, false), { activeStep: 3, progress: 80 });
  assert.deepEqual(visualState!(60_000, false), { activeStep: 3, progress: 92 });
});

test("only API completion marks every generation step complete", () => {
  const visualState = (screens as unknown as {
    generationVisualState?: (elapsedMs: number, complete: boolean) => { activeStep: number; progress: number };
  }).generationVisualState;

  assert.equal(typeof visualState, "function", "AI success needs an explicit completed state");
  assert.deepEqual(visualState!(500, true), { activeStep: 4, progress: 100 });
});

test("simulated progress is shown as a rounded percentage", () => {
  const progressLabel = (screens as unknown as {
    generationProgressLabel?: (progress: number) => string;
  }).generationProgressLabel;

  assert.equal(typeof progressLabel, "function", "the progress bar needs a visible percentage label");
  assert.equal(progressLabel!(42.6), "43%");
  assert.equal(progressLabel!(100), "100%");
});

test("generation status copy rotates within a stage without claiming early completion", () => {
  const statusMessage = (screens as unknown as {
    generationStatusMessage?: (elapsedMs: number, complete: boolean) => string;
  }).generationStatusMessage;

  assert.equal(typeof statusMessage, "function", "long generation stages need varied status copy");
  assert.equal(statusMessage!(0, false), "Checking routes that keep your trip moving smoothly...");
  assert.equal(statusMessage!(3_000, false), "Looking for fewer layovers and better arrival times...");
  assert.equal(statusMessage!(18_000, false), "Bringing every part of your trip together...");
  assert.equal(statusMessage!(21_000, false), "Making sure each day flows naturally...");
  assert.equal(statusMessage!(24_000, false), "Tucking the final details into place...");
  assert.equal(statusMessage!(60_000, false), "Still working on the finishing touches...");
  assert.equal(statusMessage!(500, true), "Your trip is ready.");
});
