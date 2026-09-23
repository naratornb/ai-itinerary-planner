// PERF-02 — copilot turn, LLM stubbed (test-plan.md §4).
//
//   k6 run -e TOKEN=<jwt> -e PACKAGE_ID=<uuid> \
//     --summary-export=out/perf-02.json apps/test/perf/k6/perf-02-copilot.js
//
// Preconditions: the API running with LLM_STUB=1, plus a throwaway draft package
// owned by the TOKEN user. Env: API_BASE (default http://localhost:8000).

import http from 'k6/http';
import { check } from 'k6';
import { API_BASE, headers, scenario, reportHandler } from './helpers.js';

export const options = scenario(5, '2m', 5000);
export const handleSummary = reportHandler('perf-02');

// ponytail: the package is created by hand and passed in, not built by a k6
// setup(). Add a setup()/teardown() pair that POSTs and deletes a draft package
// if the manual step ever gets in the way of running this unattended.
const PACKAGE_ID = __ENV.PACKAGE_ID;
if (!PACKAGE_ID || !__ENV.TOKEN) {
  throw new Error(
    'PERF-02 needs both: k6 run -e TOKEN=<jwt> -e PACKAGE_ID=<throwaway package uuid> ...'
  );
}

// PromptInput is {prompt} only (extra="forbid"), 1..1000 chars.
const PROMPTS = [
  'Suggest a three day food itinerary for Tokyo.',
  'Add a rest morning on day two and move the museum later.',
  'Swap the second dinner for something cheaper near the hotel.',
  'Recommend a half day trip outside the city for day four.',
];

export default function () {
  const body = { prompt: PROMPTS[__ITER % PROMPTS.length] };
  const res = http.post(
    `${API_BASE}/ai/copilot/${PACKAGE_ID}/turns`,
    JSON.stringify(body),
    { headers: headers() }
  );
  // The route is declared status_code=201 — a 200 here would mean the request
  // did not reach create_turn.
  check(res, { 'status is 201': (r) => r.status === 201 });
}
