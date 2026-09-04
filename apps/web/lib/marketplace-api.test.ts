import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchMarketplacePackage,
  fetchMarketplacePackages,
  searchMarketplacePackages,
  uniqueDestinationSuggestions,
} from "./marketplace-api";

const packageSummary = {
  package_id: "pkg-1",
  title: "Tokyo food tour",
  destination_country: "Japan",
  destination_city: "Tokyo",
  duration_days: 7,
  base_price_aud: 3890,
  cover_image_url: null,
  tags: [],
  influencer: null,
  published_at: null,
};

test("fetchMarketplacePackages requests the public marketplace list", async () => {
  let requestedUrl = "";
  const fetcher = async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ data: [packageSummary], meta: {} }), { status: 200 });
  };

  const result = await fetchMarketplacePackages(fetcher as typeof fetch, "http://localhost:8000/");

  assert.equal(requestedUrl, "http://localhost:8000/marketplace/packages?per_page=100");
  assert.deepEqual(result, [packageSummary]);
});

test("searchMarketplacePackages encodes the live search query", async () => {
  let requestedUrl = "";
  const fetcher = async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ query: "South Korea", data: [], meta: {} }), { status: 200 });
  };

  await searchMarketplacePackages(fetcher as typeof fetch, "http://localhost:8000", "South Korea");

  assert.equal(requestedUrl, "http://localhost:8000/marketplace/search?q=South+Korea&per_page=100");
});

test("fetchMarketplacePackage requests a package by id", async () => {
  let requestedUrl = "";
  const fetcher = async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ ...packageSummary, description: "A week in Tokyo" }), { status: 200 });
  };

  const result = await fetchMarketplacePackage(fetcher as typeof fetch, "http://localhost:8000", "pkg/a");

  assert.equal(requestedUrl, "http://localhost:8000/marketplace/packages/pkg%2Fa");
  assert.equal(result.package_id, "pkg-1");
});

test("uniqueDestinationSuggestions returns deduplicated countries and cities", () => {
  const result = uniqueDestinationSuggestions([
    packageSummary,
    { ...packageSummary, package_id: "pkg-2", destination_city: "Osaka" },
    { ...packageSummary, package_id: "pkg-3", destination_country: "Indonesia", destination_city: "Bali" },
  ]);

  assert.deepEqual(result, ["Japan", "Tokyo, Japan", "Osaka, Japan", "Indonesia", "Bali, Indonesia"]);
});

test("marketplace API helpers surface a useful error", async () => {
  const fetcher = async () => new Response("unavailable", { status: 503 });

  await assert.rejects(
    fetchMarketplacePackages(fetcher as typeof fetch, "http://localhost:8000"),
    /Unable to load marketplace packages/,
  );
});
