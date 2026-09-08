import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createCopilotClient } from "./copilot-client";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("send omits session_id on the first turn", async () => {
  let capturedBody = "";
  global.fetch = (async (_url, init) => {
    capturedBody = String(init?.body ?? "");
    return jsonResponse({
      session_id: "ab12cd34",
      copilot_message: "Here are two food experiences in Tokyo...",
      error_type: null,
      next_action: null,
      suggestions: [],
      auto_fill: { field: null, value: null },
      warnings: [],
    });
  }) as typeof fetch;

  const response = await createCopilotClient().send({
    query: "find me a food activity in Tokyo",
    session_id: null,
  });

  assert.deepEqual(JSON.parse(capturedBody), { query: "find me a food activity in Tokyo" });
  assert.equal(response.session_id, "ab12cd34");
});

test("send includes session_id on later turns", async () => {
  let capturedBody = "";
  global.fetch = (async (_url, init) => {
    capturedBody = String(init?.body ?? "");
    return jsonResponse({
      session_id: "ab12cd34",
      copilot_message: "Tell me more about which one?",
      error_type: null,
      next_action: null,
      suggestions: [],
      auto_fill: { field: null, value: null },
      warnings: [],
    });
  }) as typeof fetch;

  await createCopilotClient().send({ query: "tell me more about that one", session_id: "ab12cd34" });

  assert.deepEqual(JSON.parse(capturedBody), {
    query: "tell me more about that one",
    session_id: "ab12cd34",
  });
});

test("send throws on a non-2xx response", async () => {
  global.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;

  await assert.rejects(() =>
    createCopilotClient().send({ query: "find me a food activity", session_id: null }));
});

test("end calls DELETE on the session endpoint and never throws", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  global.fetch = (async (url, init) => {
    capturedUrl = String(url);
    capturedMethod = init?.method ?? "";
    return new Response("", { status: 204 });
  }) as typeof fetch;

  await createCopilotClient().end("ab12cd34");

  assert.equal(capturedUrl, "/api/ai/copilot/ab12cd34");
  assert.equal(capturedMethod, "DELETE");
});
