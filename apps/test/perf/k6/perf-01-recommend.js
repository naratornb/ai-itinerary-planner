// PERF-01 — itinerary generation, LLM stubbed (test-plan.md §4).
//
//   k6 run --summary-export=out/perf-01.json apps/test/perf/k6/perf-01-recommend.js
//
// Preconditions: the API running with LLM_STUB=1 (pass 1: LLM_STUB_DELAY_MS unset,
// pass 2: LLM_STUB_DELAY_MS=5000). Env: API_BASE (default http://localhost:8000).
// POST /ai/recommend takes no auth, so TOKEN is not needed here.

import http from 'k6/http';
import { check } from 'k6';
import { API_BASE, headers, scenario, reportHandler, trackFailure } from './helpers.js';

export const options = scenario(10, '2m', 8000);
export const handleSummary = reportHandler('perf-01');

// Wizard-shaped bodies matching RecommendRequest {query, origin_city}. Shapes are
// taken from the Bruno smoke collection under apps/test/; the values are invented.
const BODIES = [
  { query: '5 day food trip to Tokyo for 2 travellers', origin_city: 'Sydney' },
  { query: 'Week long family holiday in Singapore with kids', origin_city: 'Melbourne' },
  { query: '4 day diving and beach break in Bali on a budget', origin_city: 'Brisbane' },
  { query: '10 day cultural tour of Japan in spring for a couple', origin_city: 'Perth' },
];

export default function () {
  const body = BODIES[__ITER % BODIES.length];
  // Generous timeout: the 5000 ms stub-delay pass parks every request in the
  // threadpool, so k6's 60s default would report timeouts as failures.
  const res = http.post(`${API_BASE}/ai/recommend`, JSON.stringify(body), {
    headers: headers(),
    timeout: '120s',
  });
  check(res, { 'status is 200': (r) => r.status === 200 });
  trackFailure(res);
}
