import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { NextRequest } from "next/server";

import { POST } from "./route";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/ai/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stubUpstream(status: number, payload: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

test("upstream 404 becomes a 502 endpoint_unavailable, not a relayed NOT_FOUND", async () => {
  // The API answered, but has no /ai/recommend route — a deployment
  // misconfiguration. Relaying it verbatim made this look like a missing trip.
  stubUpstream(404, { error_code: "NOT_FOUND", message: "Not Found" });

  const response = await POST(postRequest({ query: "4 day trip to Iceland" }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error, "endpoint_unavailable");
  assert.match(body.detail, /\/ai\/recommend route/);
});

test("a successful itinerary is passed through untouched", async () => {
  const itinerary = { trip: { title: "Iceland" }, days: [], bookable: true };
  stubUpstream(200, itinerary);

  const response = await POST(postRequest({ query: "4 day trip to Iceland" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), itinerary);
});

test("other upstream errors are still relayed with their status", async () => {
  stubUpstream(429, { error_code: "RATE_LIMITED", message: "AI provider quota exceeded." });

  const response = await POST(postRequest({ query: "4 day trip to Iceland" }));
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.error_code, "RATE_LIMITED");
});

test("a blank query never reaches the upstream", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const response = await POST(postRequest({ query: "   " }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "missing_query");
  assert.equal(called, false);
});
