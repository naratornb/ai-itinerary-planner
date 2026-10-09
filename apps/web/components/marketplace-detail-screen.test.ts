import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { includedFlightLabel, PackageDetailView, pickerMonth } from "./marketplace-detail-screen";

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

// PackageDetailView calls useRouter(); give it a minimal app-router context.
const noop = () => undefined;
const router = { push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop } as never;
const withRouter = (element: ReturnType<typeof createElement>) =>
  createElement(AppRouterContext.Provider, { value: router }, element);

const detailPackage = {
  package_id: "p1",
  title: "Bali Slow Travel Reset",
  destination_city: "Denpasar",
  destination_country: "Indonesia",
  duration_days: 2,
  base_price_aud: 3000,
  status: "draft",
  creator_id: "c1",
  created_at: "2026-09-29T01:00:00Z",
  flights: [],
  hotels: [],
  activities: [],
  days: [],
  media: [],
} as never;

test("a creator preview keeps a sticky way out, and only one back button", () => {
  // Regression: the only exit lived inside the hero photo and scrolled away.
  const html = renderToStaticMarkup(withRouter(createElement(PackageDetailView, {
    pkg: detailPackage,
    backLabel: "Back to editor",
    onBack: () => undefined,
    previewLabel: "Draft creator preview",
  })));
  assert.match(html, /class="creator-preview-bar"/);
  assert.equal((html.match(/Back to editor/g) ?? []).length, 1, "the hero must not render a second back button");
  assert.match(html, /Draft creator preview/);
  assert.match(html, /Only you can view this package until it is published\./);
});

test("the public detail page keeps its in-hero back button and has no preview bar", () => {
  const html = renderToStaticMarkup(withRouter(createElement(PackageDetailView, {
    pkg: detailPackage,
    backLabel: "Back to marketplace",
    onBack: () => undefined,
  })));
  assert.doesNotMatch(html, /creator-preview-bar/);
  assert.equal((html.match(/Back to marketplace/g) ?? []).length, 1);
});
