// Shared config for the k6 load scenarios in this directory (PERF-01..04 of
// docs/testing/performance/test-plan.md). Run with the external k6 binary —
// nothing here is part of either app's dependency tree.

export const API_BASE = __ENV.API_BASE || 'http://localhost:8000';
export const WEB_BASE = __ENV.WEB_BASE || 'http://localhost:3000';

export function headers() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (__ENV.TOKEN) h.Authorization = `Bearer ${__ENV.TOKEN}`;
  return h;
}

// Every scenario is the same shape: constant concurrency for a fixed window,
// with the test plan's pass criteria as k6 thresholds.
export function scenario(vus, duration, p95Ms) {
  return {
    scenarios: {
      default: { executor: 'constant-vus', vus, duration },
    },
    thresholds: {
      http_req_duration: [`p(95)<${p95Ms}`],
      http_req_failed: ['rate<0.01'],
    },
  };
}
