import assert from "node:assert/strict";
import test from "node:test";
import RouteMap from "./route-map-client";

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
