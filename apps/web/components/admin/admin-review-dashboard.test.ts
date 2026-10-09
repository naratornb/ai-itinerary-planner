import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminApiError, type AdminApprovalPackage } from "../../lib/admin-api";
import {
  AdminReviewDashboardView,
  dashboardFailure,
  dashboardSessionAction,
  loadQueueEnhancements,
  nextDashboardPage,
  type AdminReviewDashboardViewProps,
} from "./admin-review-dashboard";

const packages: AdminApprovalPackage[] = [
  {
    package_id: "package/1",
    title: "Bali Slow Travel Reset",
    destination_country: "Indonesia",
    destination_city: "Denpasar",
    duration_days: 10,
    base_price_aud: 3150,
    status: "pending_review",
    creator_id: "creator-1",
    created_at: "2026-09-29T01:00:00Z",
    submitted_at: "2026-10-04T12:00:00Z",
  },
  {
    package_id: "package-2",
    title: "Tokyo Street Food Week",
    destination_country: "Japan",
    destination_city: "Tokyo",
    duration_days: 7,
    base_price_aud: 3890,
    status: "pending_review",
    creator_id: "abcdef123456",
    created_at: "2026-10-01T01:00:00Z",
    submitted_at: "2026-10-07T07:00:00Z",
  },
];

const meta = { total: 2, page: 1, per_page: 20, total_pages: 1 };
const noop = () => undefined;

function render(overrides: Partial<AdminReviewDashboardViewProps> = {}): string {
  const props: AdminReviewDashboardViewProps = {
    status: "ready",
    packages,
    meta,
    sort: "submitted_at_asc",
    perPage: 20,
    oldestSubmittedAt: packages[0].submitted_at,
    users: [{ id: "creator-1", username: "Mina Travels", email: "mina@example.com" }],
    now: "2026-10-07T12:00:00Z",
    isUpdating: false,
    reviewedPackages: [],
    reviewedMeta: { total: 0, page: 1, per_page: 20, total_pages: 0 },
    pendingDelete: null,
    isDeleting: false,
    onSortChange: noop,
    onPerPageChange: noop,
    onPageChange: noop,
    onReviewedPageChange: noop,
    onDeleteRequest: noop,
    onDeleteConfirm: noop,
    onDeleteCancel: noop,
    onRefresh: noop,
    onSignOut: noop,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(AdminReviewDashboardView, props));
}

test("loading view exposes a busy state and stable skeletons", () => {
  const html = render({ status: "loading", packages: [] });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /admin-review-skeleton/);
});

test("updating a ready queue keeps its controls mounted and announces progress", () => {
  const html = render({ isUpdating: true });

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Updating review queue/);
  assert.match(html, /Sort by/);
  assert.match(html, /aria-label="Refresh queue"/);
});

test("queue toolbar exposes only API-supported sort and page-size controls", () => {
  const html = render();

  assert.match(html, /<span>Sort by<\/span>/);
  assert.match(html, /<span>Rows<\/span>/);
  assert.match(html, /<option value="20" selected="">20<\/option>/);
  assert.match(html, /<option value="50">50<\/option>/);
  assert.match(html, /<option value="100">100<\/option>/);
  assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*class="admin-review-refresh-icon"/);
  assert.match(html, /aria-label="Refresh queue"/);
  assert.doesNotMatch(html, /<span>Refresh<\/span>/);
  assert.doesNotMatch(html, /Search packages|Filter by/);
});

test("empty view teaches the administrator that the queue is clear", () => {
  assert.match(render({ status: "empty", packages: [], meta: { ...meta, total: 0 } }), /All caught up/);
});

test("forbidden view explains access and links back to the marketplace", () => {
  const html = render({ status: "forbidden", packages: [] });
  assert.match(html, /Administrator access required/);
  assert.match(html, /href="\/marketplace"/);
});

test("request failure is announced and provides a retry action", () => {
  const html = render({ status: "error", packages: [], errorMessage: "Queue unavailable" });
  assert.match(html, /role="alert"/);
  assert.match(html, /Queue unavailable/);
  assert.match(html, />Try again<\/button>/);
});

test("ready view shows real queue details in accessible desktop and mobile structures", () => {
  const html = render();

  assert.match(html, /Pending review/);
  assert.match(html, />2<\/strong>/);
  assert.match(html, /Oldest waiting/);
  assert.match(html, /3 days/);
  assert.match(html, /Bali Slow Travel Reset/);
  assert.match(html, /Denpasar, Indonesia/);
  assert.match(html, /Mina Travels/);
  assert.match(html, /4 Oct 2026/);
  assert.match(html, /10 days/);
  assert.match(html, /\$3,150/);
  assert.match(html, /Tokyo Street Food Week/);
  assert.match(html, /Creator abcdef12/);
  assert.match(html, /<caption[^>]*>Packages waiting for review<\/caption>/);
  assert.match(html, /<th scope="col">Package<\/th>/);
  assert.match(html, /aria-label="Pending review packages for mobile"/);
  assert.match(html, /href="\/admin\/approvals\/package%2F1"/);
  assert.match(html, /aria-label="Review Bali Slow Travel Reset"/);
  assert.doesNotMatch(html, />Approve<|>Reject</);
  assert.ok((html.match(/Bali Slow Travel Reset/g) ?? []).length >= 4);
});

test("ready view presents a missing submission timestamp without a broken waiting label", () => {
  const html = render({
    packages: [{ ...packages[0], submitted_at: null }],
    oldestSubmittedAt: null,
    meta: { ...meta, total: 1 },
  });

  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /Not available waiting/);
});

test("dashboardSessionAction redirects without a token and loads with one", () => {
  assert.deepEqual(dashboardSessionAction(null), { type: "redirect" });
  assert.deepEqual(dashboardSessionAction("access-token"), {
    type: "load",
    accessToken: "access-token",
  });
});

test("dashboardFailure maps authentication, authorization, and retry outcomes", () => {
  assert.deepEqual(
    dashboardFailure(new AdminApiError("Expired", "unauthenticated", 401)),
    { type: "redirect" },
  );
  assert.deepEqual(
    dashboardFailure(new AdminApiError("Forbidden", "forbidden", 403)),
    { type: "forbidden" },
  );
  assert.deepEqual(dashboardFailure(new Error("Network down")), {
    type: "error",
    message: "Network down",
  });
});

test("nextDashboardPage backs up from an empty later page only", () => {
  const emptyResponse = { data: [], meta: { total: 20, page: 2, per_page: 20, total_pages: 1 } };
  assert.equal(nextDashboardPage(2, emptyResponse), 1);
  assert.equal(nextDashboardPage(1, { ...emptyResponse, meta: { ...emptyResponse.meta, page: 1 } }), 1);
  assert.equal(nextDashboardPage(2, { ...emptyResponse, data: packages }), 2);
});

test("queue enhancements settle independently without blocking one another", async () => {
  let resolveUsers!: (users: AdminReviewDashboardViewProps["users"]) => void;
  let resolveOldest!: (submittedAt: string | null) => void;
  const usersRequest = new Promise<AdminReviewDashboardViewProps["users"]>((resolve) => {
    resolveUsers = resolve;
  });
  const oldestRequest = new Promise<string | null>((resolve) => {
    resolveOldest = resolve;
  });
  const updates: string[] = [];

  loadQueueEnhancements(
    usersRequest,
    oldestRequest,
    () => true,
    (users) => updates.push(`users:${users.length}`),
    (oldest) => updates.push(`oldest:${oldest}`),
  );

  resolveUsers([{ id: "creator-1", username: "Mina", email: "mina@example.com" }]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, ["users:1"]);

  resolveOldest("2026-10-04T12:00:00Z");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, ["users:1", "oldest:2026-10-04T12:00:00Z"]);
});

const reviewedPackages: AdminApprovalPackage[] = [
  {
    package_id: "package-old",
    title: "Osaka Highlights",
    destination_country: "Japan",
    destination_city: "Osaka",
    duration_days: 5,
    base_price_aud: 2100,
    status: "live",
    creator_id: "creator-1",
    created_at: "2026-08-01T00:00:00Z",
    submitted_at: "2026-08-10T00:00:00Z",
  },
];

test("reviewed packages render with status badge and a per-row delete action", () => {
  const html = render({
    initialTab: "reviewed",
    reviewedPackages,
    reviewedMeta: { total: 1, page: 1, per_page: 20, total_pages: 1 },
  });

  assert.match(html, /Reviewed packages/);
  assert.match(html, /Osaka Highlights/);
  assert.match(html, /admin-review-status[^>]*>Live</);
  assert.match(html, /aria-label="Delete Osaka Highlights"/);
  assert.match(html, /aria-label="View Osaka Highlights"/);
  assert.doesNotMatch(html, /Packages waiting for review/);
});

test("tabs show both counts and default to the pending queue", () => {
  const html = render({
    reviewedPackages,
    reviewedMeta: { total: 1, page: 1, per_page: 20, total_pages: 1 },
  });

  assert.match(html, /role="tablist"/);
  assert.match(html, /id="admin-review-tab-pending"[^>]*aria-selected="true"/);
  assert.match(html, /id="admin-review-tab-reviewed"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(html, /Reviewed<span class="admin-review-tab__count">1<\/span>/);
  assert.match(html, /Packages waiting for review/);
  assert.doesNotMatch(html, /Osaka Highlights/);
});

test("an empty reviewed list still explains itself", () => {
  assert.match(render({ initialTab: "reviewed" }), /No packages have been reviewed yet\./);
});

test("a reviewed-list failure is contained to that section", () => {
  const html = render({ initialTab: "reviewed", reviewedError: "Unable to load reviewed packages." });
  assert.match(html, /role="alert">Unable to load reviewed packages\./);
  // The pending tab stays available and reports its own count.
  assert.match(html, /id="admin-review-tab-pending"/);
});

test("a pending delete renders the confirm dialog naming the package", () => {
  const html = render({ pendingDelete: reviewedPackages[0] });
  assert.match(html, /role="dialog"/);
  assert.match(html, /Delete “Osaka Highlights”\?/);
  assert.match(html, /permanently deleted/);
});
