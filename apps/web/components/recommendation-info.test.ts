import assert from "node:assert/strict";
import test from "node:test";

import * as screens from "./migrated-screens";

test("click keeps destination recommendation info open after focus opens it", () => {
  const nextOpen = (screens as unknown as {
    nextRecommendationInfoOpen?: (open: boolean, interaction: "focus" | "click" | "leave") => boolean;
  }).nextRecommendationInfoOpen;

  assert.equal(typeof nextOpen, "function", "destination info needs an explicit interaction state transition");
  let open = nextOpen!(false, "focus");
  open = nextOpen!(open, "click");

  assert.equal(open, true);
  assert.equal(nextOpen!(open, "leave"), false);
});

test("destination search results show hover feedback without replacing selection feedback", () => {
  const backgroundFor = (screens as unknown as {
    destinationOptionBackground?: (selected: boolean, hovered: boolean) => string;
  }).destinationOptionBackground;

  assert.equal(typeof backgroundFor, "function", "destination results need an explicit hover state");
  assert.equal(backgroundFor!(false, false), "transparent");
  assert.equal(backgroundFor!(false, true), "#F5F5F5");
  assert.equal(backgroundFor!(true, true), "#EFF6FF");
});

test("a selected destination fills the search field and still matches the result filter", () => {
  const destinationSelection = (screens as unknown as {
    destinationSelection?: (destination: { city: string; country: string }) => { name: string; search: string };
  }).destinationSelection;
  const destinationMatchesSearch = (screens as unknown as {
    destinationMatchesSearch?: (destination: { city: string; country: string }, query: string) => boolean;
  }).destinationMatchesSearch;

  assert.equal(typeof destinationSelection, "function", "selection needs a visible search value");
  assert.equal(typeof destinationMatchesSearch, "function", "the selected value must remain searchable");
  const selection = destinationSelection!({ city: "Amsterdam", country: "Netherlands" });

  assert.deepEqual(selection, { name: "Amsterdam, Netherlands", search: "Amsterdam, Netherlands" });
  assert.equal(destinationMatchesSearch!({ city: "Amsterdam", country: "Netherlands" }, selection.search), true);
});
