import assert from "node:assert/strict";
import test from "node:test";

import { sendCopilotTurn, setCopilotSuggestionStatus } from "./copilot-client";

const API = "http://localhost:8000";

function turnResponse(overrides: Record<string, unknown> = {}) {
  return {
    turn_id: "turn-1",
    package_id: "pkg-1",
    prompt: "Add a food tour",
    created_at: "2026-09-09T00:00:00Z",
    message: "Here are two options.",
    next_action: { type: "recommend", label: "Add to day 2" },
    warnings: [],
    suggestions: [],
    generation_mode: "live",
    response_time_ms: 120,
    ...overrides,
  };
}

test("sendCopilotTurn posts only the prompt, with the bearer token", async () => {
  let body: unknown;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), `${API}/ai/copilot/pkg-1/turns`);
    assert.equal(init?.method, "POST");
    assert.deepEqual(init?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(turnResponse()), { status: 201 });
  };

  const turn = await sendCopilotTurn(fetcher, API, "access-token", "pkg-1", "Add a food tour");

  // Extra keys are rejected by the API with a 422, so the body must be exactly this.
  assert.deepEqual(body, { prompt: "Add a food tour" });
  assert.deepEqual(Object.keys(body as object), ["prompt"]);
  assert.equal(turn.turn_id, "turn-1");
  assert.equal(turn.message, "Here are two options.");
  assert.deepEqual(turn.next_action, { type: "recommend", label: "Add to day 2" });
  assert.deepEqual(turn.warnings, []);
});

test("sendCopilotTurn flattens warnings and maps suggestion details onto the UI shape", async () => {
  const response = turnResponse({
    warnings: [{ code: "over_budget", message: "This pushes you $200 over budget." }],
    suggestions: [
      {
        item_id: "AC-NRT-001",
        item_type: "activity",
        item_name: "Tokyo Street Food Walking Tour",
        city: "Tokyo",
        country: "Japan",
        price_aud: 144,
        price_unit: "per_person",
        rating: 4.5,
        details: { category: "food", duration_hours: 3.6, suitable_for: "Foodies" },
        why_recommended: "Matches your interest in local food.",
        status: "pending",
      },
      {
        item_id: "HT-001",
        item_type: "hotel",
        item_name: "Tokyo Garden Residence",
        city: "Tokyo",
        country: null,
        price_aud: 360,
        price_unit: "per_night",
        rating: null,
        details: { room_type: "Standard twin" },
        why_recommended: "Central and quiet.",
        status: "pending",
      },
      {
        item_id: "FL-001",
        item_type: "flight",
        item_name: "SYD to NRT",
        city: "Tokyo",
        country: "Japan",
        price_aud: null,
        price_unit: "per_person",
        rating: null,
        details: { cabin_class: "Economy", duration_mins: 90 },
        why_recommended: "Cheapest direct.",
        status: "pending",
      },
    ],
  });
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(response), { status: 201 });

  const turn = await sendCopilotTurn(fetcher, API, "access-token", "pkg-1", "Add a food tour");

  assert.deepEqual(turn.warnings, ["This pushes you $200 over budget."]);

  const [activity, hotel, flight] = turn.suggestions;
  assert.deepEqual(activity, {
    item_id: "AC-NRT-001",
    item_type: "activity",
    item_name: "Tokyo Street Food Walking Tour",
    city: "Tokyo",
    country: "Japan",
    price_aud: 144,
    price_unit: "per_person",
    rating: 4.5,
    category: "food",
    duration_hours: 3.6,
    suitable_for: "Foodies",
    why_recommended: "Matches your interest in local food.",
  });

  // Hotels carry a room type instead of a category, and no duration at all.
  assert.equal(hotel.category, "Standard twin");
  assert.equal(hotel.duration_hours, null);
  assert.equal(hotel.suitable_for, null);
  assert.equal(hotel.country, null);
  assert.equal(hotel.rating, null);

  // Flights report minutes, the UI works in hours.
  assert.equal(flight.category, "Economy");
  assert.equal(flight.duration_hours, 1.5);
  assert.equal(flight.rating, null);
  assert.equal(flight.price_aud, null);
});

test("sendCopilotTurn surfaces the API's own error message", async () => {
  const fetcher: typeof fetch = async () => new Response(
    JSON.stringify({ error_code: "package_not_found", message: "That package no longer exists." }),
    { status: 404 },
  );

  await assert.rejects(
    sendCopilotTurn(fetcher, API, "access-token", "missing", "hi"),
    /That package no longer exists\./,
  );
});

test("sendCopilotTurn identifies an expired login", async () => {
  const fetcher: typeof fetch = async () => new Response("{}", { status: 401 });

  await assert.rejects(
    sendCopilotTurn(fetcher, API, "expired-token", "pkg-1", "hi"),
    /^Error: Your session expired\. Please sign in again\.$/,
  );
});

test("setCopilotSuggestionStatus patches only the status", async () => {
  let body: unknown;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), `${API}/ai/copilot/pkg-1/turns/turn-1/items/AC-NRT-001`);
    assert.equal(init?.method, "PATCH");
    assert.deepEqual(init?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ item_id: "AC-NRT-001", status: "dismissed" }), { status: 200 });
  };

  await setCopilotSuggestionStatus(fetcher, API, "access-token", "pkg-1", "turn-1", "AC-NRT-001", "dismissed");

  // auto_apply is never sent — the editor applies accepted items itself.
  assert.deepEqual(body, { status: "dismissed" });
});

test("setCopilotSuggestionStatus treats an already-resolved suggestion as done", async () => {
  const fetcher: typeof fetch = async () => new Response(
    JSON.stringify({ error_code: "already_resolved", message: "Suggestion already resolved." }),
    { status: 409 },
  );

  await setCopilotSuggestionStatus(fetcher, API, "access-token", "pkg-1", "turn-1", "AC-NRT-001", "accepted");
});

test("setCopilotSuggestionStatus still throws on a real failure", async () => {
  const fetcher: typeof fetch = async () => new Response(
    JSON.stringify({ error_code: "turn_not_found", message: "That suggestion is gone." }),
    { status: 404 },
  );

  await assert.rejects(
    setCopilotSuggestionStatus(fetcher, API, "access-token", "pkg-1", "turn-1", "AC-NRT-001", "accepted"),
    /That suggestion is gone\./,
  );
});
