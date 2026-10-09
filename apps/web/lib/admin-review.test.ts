import assert from "node:assert/strict";
import test from "node:test";

import type { AdminApprovalPackage, AdminUser } from "./admin-api";
import type { BuilderDay } from "./itinerary-builder";
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
  reviewPhotos,
  safeImageSrc,
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

test("safeImageSrc only lets http(s) addresses through", () => {
  assert.equal(safeImageSrc("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
  assert.equal(safeImageSrc("http://cdn.example.com/a.jpg"), "http://cdn.example.com/a.jpg");
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAA", "/relative.jpg", "not a url", "", null, undefined]) {
    assert.equal(safeImageSrc(bad), "", String(bad));
  }
});

test("reviewPhotos lists every upload with where it is used, and marks the cover and unplaced photos", () => {
  const day = (n: number, photos: BuilderDay["photos"], items: BuilderDay["items"] = []): BuilderDay =>
    ({ id: `day-${n}`, day: n, title: `Day ${n}`, meta: "", story: "", photos, items }) as BuilderDay;
  const photos = reviewPhotos(
    {
      cover_image_url: "https://cdn.example.com/b.jpg",
      media: [
        { media_id: "m1", url: "https://cdn.example.com/a.jpg", caption: " Beach " },
        { media_id: "m2", url: "https://cdn.example.com/b.jpg" },
        { media_id: "m3", url: "https://cdn.example.com/c.jpg" },
      ],
    },
    [
      day(1, [{ src: "x", alt: "", media_id: "m1" }]),
      day(2, [], [{ id: 1, title: "Hilton", photos: [{ src: "x", alt: "", media_id: "m1" }, { src: "x", alt: "", media_id: "m2" }] } as BuilderDay["items"][number]]),
    ],
  );

  assert.deepEqual(photos.map((p) => p.isCover), [false, true, false]);
  assert.equal(photos[0].caption, "Beach");
  assert.deepEqual(photos[0].placements, ["Day 1", "Day 2 · Hilton"]);
  assert.deepEqual(photos[1].placements, ["Day 2 · Hilton"]);
  assert.deepEqual(photos[2].placements, [], "an upload no day or stop uses is reported as unplaced");
});

test("reviewPhotos falls back to the first upload as cover and tolerates no media", () => {
  assert.deepEqual(reviewPhotos({ media: null }, []), []);
  const [first, second] = reviewPhotos({ media: [{ media_id: "a", url: "https://x.test/1.jpg" }, { media_id: "b", url: "https://x.test/2.jpg" }] }, []);
  assert.equal(first.isCover, true);
  assert.equal(second.isCover, false);
});
