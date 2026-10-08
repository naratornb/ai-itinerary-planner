import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("oversized day photos are cropped without setting the panel height", () => {
  assert.match(
    styles,
    /\.day-photo-single figure\s*\{[^}]*overflow:\s*hidden/,
  );
  assert.match(
    styles,
    /\.day-photo-single img\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*object-fit:\s*cover/,
  );
});

test("day photo delete control stays visible as a white corner badge", () => {
  assert.match(
    styles,
    /\.day-photo-single \.remove-photo-btn\s*\{[^}]*width:\s*28px[^}]*height:\s*28px[^}]*background:\s*#fff[^}]*color:\s*var\(--fc-ink\)[^}]*box-shadow:[^}]*\}[\s\S]*?\.day-photo-single \.remove-photo-btn svg\s*\{[^}]*width:\s*16px[^}]*height:\s*16px/,
  );
});

test("timeline badges align with their titles and supporting copy", () => {
  const rule = styles.match(/\.item-copy-head\s*\{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(rule, /margin-left:\s*-/);
});
