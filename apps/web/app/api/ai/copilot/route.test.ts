import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/ai/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("a known city with matching inventory returns suggestions", async () => {
  const response = await POST(postRequest({ query: "find me a food activity in Tokyo", session_id: null }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.error_type, null);
  assert.ok(body.suggestions.length > 0);
  assert.ok(body.suggestions.every((s: { city: string }) => s.city === "Tokyo"));
});

test("a query with no city asks for clarification", async () => {
  const response = await POST(postRequest({ query: "something adventurous next", session_id: null }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.error_type, "HUMAN_INPUT_ERROR");
  assert.deepEqual(body.suggestions, []);
});

test("a city outside the mock catalogue reports a DB gap, not a false empty result", async () => {
  const response = await POST(postRequest({ query: "find a hike in Paris", session_id: null }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.error_type, "DB_GAP_ERROR");
  assert.deepEqual(body.suggestions, []);
});

test("a follow-up detail request is classified before city matching", async () => {
  const response = await POST(postRequest({ query: "tell me more about that one", session_id: "abc" }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.error_type, "DETAIL_REQUEST");
  assert.equal(body.session_id, "abc");
});

test("a blank query is rejected before classification", async () => {
  const response = await POST(postRequest({ query: "  ", session_id: null }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "missing_query");
});
