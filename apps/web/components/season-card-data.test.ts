import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { seasonChoiceComplete, seasonSecondaryAction } from "./migrated-screens";

test("season step accepts an explicit no-preference choice", () => {
  assert.equal(seasonChoiceComplete(null, false), false);
  assert.equal(seasonChoiceComplete(null, true), true);
  assert.equal(seasonChoiceComplete("winter", false), true);
});

test("season step only offers a seasonless build when no season is selected", () => {
  const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");

  assert.equal(seasonSecondaryAction(null), "build-without-season");
  assert.equal(seasonSecondaryAction("winter"), "clear-season");
  assert.match(source, /\? "Clear season" :/);
  assert.match(source, /if \(seasonSecondaryAction\(season\) === "clear-season"\) \{\s*setSeason\(null\);\s*return;/);
});

test("season cards do not claim hard-coded recommendation months", () => {
  const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /seasonMonthRange|SEASON_MONTHS|SEASON_COUNTRIES|Best:/);
});

test("season cards show selection without a Selected text badge", () => {
  const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, />Selected<\/span>/);
  assert.match(source, /aria-label="Selected"/);
});

test("season cards place photography beside the existing content", () => {
  const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /className="ai-wizard-season-card"/);
  assert.match(source, /className="ai-wizard-season-image"/);
  assert.match(source, /className="ai-wizard-season-content"/);
  assert.match(styles, /\.ai-wizard-season-card\s*\{[^}]*grid-template-columns:\s*minmax\(150px, 40%\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.ai-wizard-season-grid\s*\{[^}]*grid-template-rows:\s*repeat\(2, 168px\)/);
  assert.match(styles, /\.ai-wizard-season-content\s*\{[^}]*padding:\s*20px/);
  assert.match(styles, /\.ai-wizard-season-title\s*\{[^}]*font-size:\s*16px/);
  assert.match(styles, /\.ai-wizard-season-description\s*\{[^}]*font-size:\s*13px/);
  assert.match(styles, /\.ai-wizard-season-meta\s*\{[^}]*font-size:\s*11px/);
});

test("season card copy uses grouped spacing for a clear hierarchy", () => {
  const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(source, /className="ai-wizard-season-summary"/);
  assert.match(source, /className="ai-wizard-season-tags"/);
  assert.match(styles, /\.ai-wizard-season-summary\s*\{[^}]*gap:\s*6px/);
  assert.match(styles, /\.ai-wizard-season-tags\s*\{[^}]*margin-top:\s*14px[^}]*gap:\s*6px/);
});

test("season step starts the build immediately when season is skipped", () => {
  const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");

  assert.match(source, /Build without a seasonal preference\./);
  assert.match(source, /setNoSeasonPreference\(true\);\s*if \(variant === "manual"\).*\s*else startBuild\(setupForSeason\(null\)\);/);
  assert.match(source, /"Build without season"/);
});
