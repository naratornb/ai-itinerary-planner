import assert from "node:assert/strict";
import test from "node:test";

import { includedFlightLabel, pickerMonth } from "./marketplace-detail-screen";

test("pickerMonth keeps the selected value's month", () => {
  assert.equal(pickerMonth("2026-12-01", ["2026-11-13", "2026-12-01"]), "2026-12");
});

test("pickerMonth falls back to the first catalog date when nothing is selected", () => {
  // Regression: a date-free package flight leaves value="" — "" sliced to a
  // month produced NaN dates (empty grid, "Invalid Date" label) and a
  // RangeError crash when the month nav was clicked.
  assert.equal(pickerMonth("", ["2026-11-13", "2026-12-01"]), "2026-11");
});

test("pickerMonth never returns an invalid month", () => {
  assert.match(pickerMonth("", []), /^\d{4}-\d{2}$/);
  assert.match(pickerMonth("garbage", []), /^\d{4}-\d{2}$/);
});

test("includedFlightLabel says 'Flight' for a one-leg package", () => {
  // Regression: the label read "Return flights" even when the package only
  // has an outbound leg.
  assert.equal(includedFlightLabel(true), "Return flights");
  assert.equal(includedFlightLabel(false), "Flight");
});
