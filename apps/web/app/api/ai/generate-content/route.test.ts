import assert from "node:assert/strict";
import test from "node:test";

process.env.GEMINI_API_KEY = "test-key";

import { POST } from "./route";

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: "A lovely day in Tokyo." }] } }],
  usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 400, totalTokenCount: 1000 },
};

function contentRequest() {
  return new Request("http://localhost/api/ai/generate-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "day",
      packageTitle: "Tokyo Discovery",
      destination: "Tokyo",
      selectedHotel: "Shinjuku Central Hotel",
      dayTitle: "Old town and skyline",
      dayNumber: 1,
      totalDays: 5,
      items: ["Senso-ji Temple"],
      vibe: "Culture",
    }),
  });
}

test("success response carries Gemini usageMetadata through", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(GEMINI_OK), { status: 200 })) as typeof fetch;
  try {
    const res = await POST(contentRequest() as any);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.listing, "A lovely day in Tokyo.");
    assert.deepEqual(body.usageMetadata, GEMINI_OK.usageMetadata);
  } finally {
    globalThis.fetch = realFetch;
  }
});
