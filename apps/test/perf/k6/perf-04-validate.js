// PERF-04 — validate route, deterministic path (test-plan.md §4).
//
//   k6 run --summary-export=out/perf-04.json apps/test/perf/k6/perf-04-validate.js
//
// Preconditions: apps/web built and served with `next build && next start`.
// The plan wants the AI contextual checks skipped so only the deterministic
// feasibility checks are measured. Note the route returns 500 when
// GEMINI_API_KEY is *unset* — the graceful skip is on the Gemini response, not
// on the key. So set GEMINI_API_KEY to a value the Gemini API will reject: the
// route logs the non-OK response and falls through to the code checks.
// Env: WEB_BASE (default http://localhost:3000). The route takes no auth.

import http from 'k6/http';
import { check } from 'k6';
import { WEB_BASE, headers, scenario } from './helpers.js';

export const options = scenario(10, '1m', 2000);

// Shape mirrors buildValidationPayload() in apps/web/components/itinerary-editor.tsx:
// package-level fields plus days_json as a JSON *string*. Values are invented and
// deliberately clean — the route hard-blocks on competitor names, war-zone country
// names and profanity anywhere in the payload, which would change what is measured.
const DAYS = [
  {
    day_number: 1,
    summary: 'Arrive and settle in near the station.',
    has_accommodation: true,
    flights: [
      { arrival_time: '09:10', flight_type: 'international', title: 'Sydney to Tokyo' },
    ],
    activities: [
      {
        activity_name: 'Old town walking tour',
        start_time: '14:00',
        slot: 'Afternoon',
        category: 'Sightseeing',
        duration_hours: 2,
        suitable_for: 'Couple',
        address: '1 Station Road',
        description: 'Guided stroll through the historic district.',
        price: 60,
      },
    ],
  },
  {
    day_number: 2,
    summary: 'A full day of markets and museums.',
    has_accommodation: true,
    flights: [],
    activities: [
      {
        activity_name: 'Morning market tasting',
        start_time: '09:00',
        slot: 'Morning',
        category: 'Food',
        duration_hours: 2.5,
        suitable_for: 'Couple',
        address: '5 Market Lane',
        description: 'Sample local produce with a guide.',
        price: 95,
      },
      {
        activity_name: 'City art museum',
        start_time: '14:30',
        slot: 'Afternoon',
        category: 'Culture',
        duration_hours: 2,
        suitable_for: 'Couple',
        address: '20 Gallery Street',
        description: 'Permanent collection and a rotating exhibition.',
        price: 30,
      },
    ],
  },
  {
    day_number: 3,
    summary: 'Day trip out of the city, then fly home.',
    has_accommodation: true,
    flights: [
      { arrival_time: '21:40', flight_type: 'international', title: 'Tokyo to Sydney' },
    ],
    activities: [
      {
        activity_name: 'Lakeside day trip',
        start_time: '08:30',
        slot: 'Morning',
        category: 'Nature',
        duration_hours: 6,
        suitable_for: 'Couple',
        address: 'Lakeside Terminal',
        description: 'Train out to the lake, boat cruise and lunch.',
        price: 140,
      },
    ],
  },
];

const PAYLOAD = JSON.stringify({
  package_id: '00000000-0000-0000-0000-000000000001',
  trip_name: 'Three days in Tokyo',
  city: 'Tokyo',
  country: 'Japan',
  travel_month: 'April',
  total_days: DAYS.length,
  group_size: 2,
  hotel_name: 'Station Garden Hotel',
  hotel_stars: 4,
  photo_count: 6,
  days_json: JSON.stringify(DAYS),
});

export default function () {
  const res = http.post(`${WEB_BASE}/api/ai/validate`, PAYLOAD, { headers: headers() });
  check(res, { 'status is 200': (r) => r.status === 200 });
}
