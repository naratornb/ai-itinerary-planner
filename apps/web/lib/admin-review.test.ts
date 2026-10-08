import assert from "node:assert/strict";
import test from "node:test";

import type { AdminApprovalPackage, AdminUser } from "./admin-api";
import {
  approvalResultRange,
  creatorLabel,
  formatAdminDestination,
  formatAdminDuration,
  formatAdminPrice,
  formatSubmittedAt,
  formatWaitingAge,
  optionalAdminUsers,
  requestSequenceIsCurrent,
} from "./admin-review";

const users: AdminUser[] = [
  { id: "creator-1", username: "Mina Travels", email: "mina@example.com" },
  { id: "creator-2", username: "", email: "jo@example.com" },
];

test("creatorLabel prefers username, then email local-part, then a stable ID fallback", () => {
  assert.equal(creatorLabel("creator-1", users), "Mina Travels");
  assert.equal(creatorLabel("creator-2", users), "jo");
  assert.equal(creatorLabel("abcdef123456", users), "Creator abcdef12");
});

test("formatWaitingAge returns concise elapsed labels and rejects unusable dates", () => {
  const now = "2026-10-07T12:00:00Z";
  assert.equal(formatWaitingAge("2026-10-07T11:30:00Z", now), "30 minutes");
  assert.equal(formatWaitingAge("2026-10-07T07:00:00Z", now), "5 hours");
  assert.equal(formatWaitingAge("2026-10-04T12:00:00Z", now), "3 days");
  assert.equal(formatWaitingAge("2026-10-07T11:59:00Z", now), "1 minute");
  assert.equal(formatWaitingAge(null, now), "Not available");
  assert.equal(formatWaitingAge("not-a-date", now), "Not available");
  assert.equal(formatWaitingAge("2026-10-08T12:00:00Z", now), "Not available");
});

test("formatSubmittedAt formats valid timestamps and protects invalid values", () => {
  assert.equal(formatSubmittedAt("2026-10-01T02:00:00Z"), "1 Oct 2026");
  assert.equal(formatSubmittedAt(null), "Not available");
  assert.equal(formatSubmittedAt("not-a-date"), "Not available");
});

test("dashboard value formatters tolerate missing package data", () => {
  const destination = (overrides: Partial<AdminApprovalPackage>) =>
    formatAdminDestination({
      destination_city: null,
      destination_country: null,
      ...overrides,
    });

  assert.equal(destination({ destination_city: "Paris", destination_country: "France" }), "Paris, France");
  assert.equal(destination({ destination_country: "France" }), "France");
  assert.equal(destination({}), "Not provided");
  assert.equal(formatAdminDuration(1), "1 day");
  assert.equal(formatAdminDuration(4), "4 days");
  assert.equal(formatAdminDuration(null), "Not provided");
  assert.equal(formatAdminPrice(3150), "$3,150");
  assert.equal(formatAdminPrice(null), "Not provided");
});

test("approvalResultRange describes paginated and empty results", () => {
  assert.equal(
    approvalResultRange({ total: 21, page: 2, per_page: 20, total_pages: 2 }, 1),
    "Showing 21–21 of 21",
  );
  assert.equal(
    approvalResultRange({ total: 0, page: 1, per_page: 20, total_pages: 0 }, 0),
    "Showing 0 of 0",
  );
});

test("optionalAdminUsers preserves users but turns enrichment failure into an empty list", async () => {
  assert.deepEqual(await optionalAdminUsers(Promise.resolve(users)), users);
  assert.deepEqual(await optionalAdminUsers(Promise.reject(new Error("unavailable"))), []);
});

test("requestSequenceIsCurrent accepts only the active request", () => {
  assert.equal(requestSequenceIsCurrent(3, 3), true);
  assert.equal(requestSequenceIsCurrent(2, 3), false);
});
