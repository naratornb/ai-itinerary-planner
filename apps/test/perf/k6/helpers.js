// Shared config for the k6 load scenarios in this directory (PERF-01..04 of
// docs/testing/performance/test-plan.md). Run with the external k6 binary —
// nothing here is part of either app's dependency tree.

import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { Counter } from 'k6/metrics';

const failed4xx = new Counter('failed_4xx');
const failed5xx = new Counter('failed_5xx');
let bodiesLogged = 0;

// Call after every request: counts failures by status class and logs the
// first few failing bodies per VU so a failed threshold names its cause.
export function trackFailure(res) {
  if (res.status < 400) return;
  (res.status < 500 ? failed4xx : failed5xx).add(1, { status: String(res.status) });
  if (bodiesLogged < 3) {
    bodiesLogged++;
    console.error(`[fail] ${res.status} ${res.url} :: ${String(res.body).slice(0, 200)}`);
  }
}

export const API_BASE = __ENV.API_BASE || 'http://localhost:8000';
export const WEB_BASE = __ENV.WEB_BASE || 'http://localhost:3000';

export function headers() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (__ENV.TOKEN) h.Authorization = `Bearer ${__ENV.TOKEN}`;
  return h;
}

// k6-reporter templated HTML report per scenario (out/<name>.html), keeping
// the usual console summary. Scripts re-export: export const handleSummary = ...
export function reportHandler(name) {
  return (data) => ({
    [`out/${name}.html`]: htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  });
}

// Every scenario is the same shape: constant concurrency for a fixed window,
// with the test plan's pass criteria as k6 thresholds.
export function scenario(vus, duration, p95Ms) {
  return {
    scenarios: {
      // -e DURATION=10s smoke-runs any scenario without editing it.
      default: { executor: 'constant-vus', vus, duration: __ENV.DURATION || duration },
    },
    thresholds: {
      http_req_duration: [`p(95)<${p95Ms}`],
      http_req_failed: ['rate<0.01'],
    },
  };
}
