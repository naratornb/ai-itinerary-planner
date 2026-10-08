import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./migrated-screens.tsx", import.meta.url), "utf8");

test("dashboard subtitle does not promise bookings or earnings data the screen lacks", () => {
  assert.match(source, /Manage your packages and track their review status\./);
  assert.doesNotMatch(source, /bookings and earnings/);
});

test("row hover keys on package id so duplicate names do not cross-highlight", () => {
  assert.match(source, /hovRow === pkg\.id/);
  assert.match(source, /setHovRow\(pkg\.id\)/);
  assert.doesNotMatch(source, /setHovRow\(pkg\.name\)/);
});

test("package table scrolls horizontally instead of clipping Status and Actions", () => {
  assert.match(source, /overflowX: "auto"/);
  assert.match(source, /minWidth: 1020/);
});

test("package search has an accessible name and a clear button", () => {
  assert.match(source, /aria-label="Search packages"/);
  assert.match(source, /aria-label="Clear package search"/);
});

test("an empty filtered result offers a Clear filters reset", () => {
  assert.match(source, /Clear filters/);
  assert.match(source, /setSearchQ\(""\); setActiveTab\("All"\)/);
});
