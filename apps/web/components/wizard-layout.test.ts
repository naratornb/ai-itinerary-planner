import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const screens = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");

test("package setup keeps its progress horizontal and within the desktop viewport", () => {
  assert.match(styles, /\.ai-wizard-screen\s*\{[\s\S]*?height:\s*calc\(100vh - 64px\)[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.ai-wizard-layout\s*\{[\s\S]*?display:\s*flex[^}]*flex-direction:\s*column/);
  assert.match(styles, /\.ai-wizard-layout\s*\{[^}]*width:\s*min\(calc\(100% - 64px\), 960px\)/);
  assert.match(styles, /\.ai-wizard-progress\s*\{[\s\S]*?flex-direction:\s*row/);
  assert.match(styles, /\.ai-wizard-progress-step:last-child\s*\{[^}]*flex:\s*0 0 auto/);
});

test("package creation navigation stays directly below the global header", () => {
  assert.match(screens, /position:\s*"sticky",\s*top:\s*0,\s*zIndex:\s*90/);
});

test("package creation choices use the wider centered container", () => {
  assert.match(screens, /width:\s*"min\(calc\(100% - 48px\), 800px\)"/);
});
