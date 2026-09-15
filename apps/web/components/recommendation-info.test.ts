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

test("manual package creation requires a destination selected from the catalog", () => {
  type Draft = {
    title: string;
    description: string;
    destination_country: string;
    destination_city: string;
    duration_days: string;
    base_price_aud: string;
    max_group_size: string;
  };
  const applyDestination = (screens as unknown as {
    applyCatalogDestination?: (draft: Draft, destination: { city: string; country: string } | null) => Draft;
  }).applyCatalogDestination;
  const isValid = (screens as unknown as {
    isNewPackageDraftValid?: (draft: Draft) => boolean;
  }).isNewPackageDraftValid;
  const draft: Draft = {
    title: "Kyoto Autumn Cultural Tour",
    description: "A guided cultural itinerary.",
    destination_country: "",
    destination_city: "",
    duration_days: "4",
    base_price_aud: "2200",
    max_group_size: "",
  };

  assert.equal(typeof applyDestination, "function", "manual creation needs catalog-backed destination state");
  assert.equal(typeof isValid, "function", "manual creation needs explicit destination validation");
  assert.equal(isValid!(draft), false);

  const selected = applyDestination!(draft, { city: "Kyoto", country: "Japan" });
  assert.deepEqual(
    { city: selected.destination_city, country: selected.destination_country },
    { city: "Kyoto", country: "Japan" },
  );
  assert.equal(isValid!(selected), true);
  assert.equal(isValid!(applyDestination!(selected, null)), false);
});

test("manual and AI destination steps use the same recommended and searched options", () => {
  type Destination = { city: string; country: string; avgRating: number };
  const optionsForSearch = (screens as unknown as {
    destinationOptionsForSearch?: (destinations: Destination[], recommended: Destination[], query: string) => Destination[];
  }).destinationOptionsForSearch;
  const destinations = [
    { city: "Athens", country: "Greece", avgRating: 4.7 },
    { city: "Kyoto", country: "Japan", avgRating: 4.9 },
  ];
  const recommended = [destinations[1]];

  assert.equal(typeof optionsForSearch, "function", "both flows need one destination display rule");
  assert.deepEqual(optionsForSearch!(destinations, recommended, ""), recommended);
  assert.deepEqual(optionsForSearch!(destinations, recommended, "gree"), [destinations[0]]);
});

test("manual package steps unlock only when their required fields are complete", () => {
  type Draft = {
    title: string;
    description: string;
    destination_country: string;
    destination_city: string;
    duration_days: string;
    base_price_aud: string;
    max_group_size: string;
  };
  const isStepValid = (screens as unknown as {
    isManualPackageStepValid?: (draft: Draft, step: number) => boolean;
  }).isManualPackageStepValid;
  const draft: Draft = {
    title: "Kyoto Autumn Cultural Tour",
    description: "A guided cultural itinerary.",
    destination_country: "Japan",
    destination_city: "Kyoto",
    duration_days: "4",
    base_price_aud: "2200",
    max_group_size: "",
  };

  assert.equal(typeof isStepValid, "function");
  assert.equal(isStepValid!(draft, 0), true);
  assert.equal(isStepValid!({ ...draft, title: "" }, 0), false);
  assert.equal(isStepValid!(draft, 1), true);
  assert.equal(isStepValid!({ ...draft, destination_city: "" }, 1), false);
  assert.equal(isStepValid!(draft, 2), true);
  assert.equal(isStepValid!({ ...draft, base_price_aud: "" }, 2), false);
  assert.equal(isStepValid!(draft, 3), true);
});
