import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import RouteMap, { stopInfoText } from "./route-map-client";

test("map skips identical stops from editor rerenders but updates changed routes", () => {
  const compare = Reflect.get(RouteMap, "compare");
  assert.equal(typeof compare, "function");
  const stops = [{ label: "Market", time: "10:00", coordinate: [40.4, -3.7] }];
  assert.equal(compare({ stops }, { stops: structuredClone(stops) }), true);
  for (const change of [{ label: "Museum" }, { time: "11:00" }, { coordinate: [40.5, -3.7] }]) {
    assert.equal(compare({ stops }, { stops: [{ ...stops[0], ...change }] }), false);
  }
  assert.equal(compare({ stops }, { stops: [] }), false);
});

test("stopInfoText renders label and time as plain text", () => {
  assert.equal(stopInfoText({ label: "Market", coordinate: [0, 0] }), "Market");
  assert.equal(stopInfoText({ label: "Market", time: "10:00", coordinate: [0, 0] }), "Market · 10:00");
  assert.equal(stopInfoText({ label: "<img onerror=x>", coordinate: [0, 0] }), "<img onerror=x>");
});

test("stop labels reach the InfoWindow as text, not HTML", () => {
  // setContent(string) parses markup — an activity named "<img onerror=…>"
  // would execute inside the map popup. The content must be a DOM node.
  const source = readFileSync(new URL("./route-map-client.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /infoWindow\.setContent\(\s*["'`]/);
  assert.match(source, /textContent\s*=\s*stopInfoText|\.textContent\s*=/);
});
