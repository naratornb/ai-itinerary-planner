// PERF-03 — marketplace list + search, no AI (test-plan.md §4).
//
//   k6 run --summary-export=out/perf-03.json apps/test/perf/k6/perf-03-marketplace.js
//
// Preconditions: the API running against the seeded Supabase project. Both
// endpoints are public (anon key + RLS), so TOKEN is not needed.
// Env: API_BASE (default http://localhost:8000).

import http from 'k6/http';
import { check } from 'k6';
import { API_BASE, headers, scenario, reportHandler, trackFailure } from './helpers.js';

export const options = scenario(20, '2m', 2000);
export const handleSummary = reportHandler('perf-03');

// Browse queries against GET /marketplace/packages.
const LISTS = [
  'page=1&per_page=20',
  'page=2&per_page=20',
  'destination_country=Japan&sort=price_asc',
  'min_price_aud=1000&max_price_aud=5000&sort=published_at_desc',
  'min_nights=3&max_nights=10&sort=duration_asc',
];

// Search terms for GET /marketplace/search — the route rejects anything shorter
// than 2 characters with a 400, so every term here is longer than that.
const SEARCHES = ['Tokyo', 'beach', 'food tour', 'family', 'island hopping'];

export default function () {
  // Alternate browse and search so the run is the mixed traffic the plan asks for.
  // __ITER restarts at 0 in every VU, so the VU number is folded in to stop all 20
  // workers hammering the identical query at the same moment and measuring the
  // database's cache instead of the endpoint.
  const i = __VU + __ITER;
  const url =
    i % 2 === 0
      ? `${API_BASE}/marketplace/packages?${LISTS[i % LISTS.length]}`
      : `${API_BASE}/marketplace/search?q=${encodeURIComponent(
          SEARCHES[i % SEARCHES.length]
        )}`;
  const res = http.get(url, { headers: headers() });
  check(res, { 'status is 200': (r) => r.status === 200 });
  trackFailure(res);
}
