import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");

test("no dead controls pretend to act in the marketplace chrome", () => {
  // Regression: the migrated shell shipped clickable controls that did
  // nothing — a "Get the app"/"Get a Quote"/"Help" header row, a Help
  // button in the creator nav, an "Account settings" item that only closed
  // its own menu, and two "filter" pills with no filter behind them.
  assert.doesNotMatch(source, /Get the app/);
  assert.doesNotMatch(source, /Get a Quote/);
  assert.doesNotMatch(source, /Account settings/);
  assert.doesNotMatch(source, /All departure dates/);
  assert.doesNotMatch(source, /All trip types/);
});

test("the creator-apply CTA goes somewhere real", () => {
  // Regression: "Apply to join as a creator" rendered with no onClick — the
  // page's main conversion action silently did nothing.
  assert.match(source, /router\.push\("\/register"\)[\s\S]{0,400}Apply to join as a creator/);
});

test("the footer does not carry the reference brand's corporate copy", () => {
  // Regression: "since 1981" and "Travel Group Limited" are the source
  // brand's history/company name, not this product's — displayed as facts.
  assert.doesNotMatch(source, /since 1981/);
  assert.doesNotMatch(source, /Travel Group Limited/);
  assert.doesNotMatch(source, /1300 859 334/);
});

test("manual package creation is guarded by a ref, not async state", () => {
  // Regression: createManualPackage only disabled the button via
  // `manualCreating` state — a second click inside the same frame fired a
  // duplicate createPackage call and left an orphan draft.
  const createManual = source.match(/const createManualPackage = async[\s\S]*?\n  \};/);
  assert.ok(createManual, "createManualPackage must exist");
  assert.match(createManual[0], /Ref\.current/, "must check a ref synchronously");
});
