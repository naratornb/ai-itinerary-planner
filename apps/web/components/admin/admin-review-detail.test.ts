import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AdminPackageDetail } from "../../lib/admin-api";
import {
  AdminReviewDetailView,
  decisionNotice,
  detailFailure,
  rejectionReasonError,
  type AdminReviewDetailViewProps,
} from "./admin-review-detail";

const packageDetail: AdminPackageDetail = {
  package_id: "package-1",
  title: "Bali Slow Travel Reset",
  destination_country: "Indonesia",
  destination_city: "Denpasar",
  duration_days: 2,
  base_price_aud: 3150,
  status: "pending_review",
  creator_id: "creator-1",
  created_at: "2026-09-29T01:00:00Z",
  submitted_at: "2026-10-04T12:00:00Z",
  cover_image_url: "https://images.example.com/bali.jpg",
  description: "A measured itinerary focused on local food and quieter neighbourhoods.",
  max_group_size: 8,
  season: "dry season",
  tags: ["food", "slow travel"],
  flights: [
    {
      flight_id: "flight-1",
      day_number: 1,
      sequence_order: 1,
      airline: "Example Air",
      flight_number: "EA100",
      origin_iata: "BNE",
      destination_iata: "DPS",
      departure_time: "09:15",
      arrival_time: "13:40",
      cabin_class: "Economy",
      price_aud: 1200,
    },
  ],
  hotels: [
    {
      hotel_id: "hotel-1",
      hotel_name: "Ubud Garden Stay",
      star_rating: 4,
      city: "Ubud",
      address: "10 Example Road",
      price_per_night_aud: 750,
      room_type: "Garden Room",
      check_in_day: 1,
      check_out_day: 2,
      nights: 1,
    },
  ],
  activities: [
    {
      activity_id: "activity-1",
      sequence_order: 2,
      activity_name: "Market walk",
      city: "Ubud",
      duration_hours: 2,
      price_aud: 450,
      description: "Meet local producers.",
      booking_required: true,
      day_number: 1,
      start_time: "15:00",
    },
  ],
  days: [
    { id: "day-1", day_number: 1, title: "Arrive and settle in", summary: "A gentle first day." },
    { id: "day-2", day_number: 2, title: "Ubud at your pace", summary: "Food and craft." },
  ],
  media: [],
  creator: { full_name: "Mina Travels", avatar_url: null, influencer_profiles: [] },
  latest_approval: null,
  pricing: {
    flights_total: 1200,
    hotels_total: 1500,
    activities_total: 450,
    components_total: 3150,
    base_price_aud: 3150,
  },
};

const noop = () => undefined;

function render(overrides: Partial<AdminReviewDetailViewProps> = {}) {
  const props: AdminReviewDetailViewProps = {
    status: "ready",
    packageDetail,
    selectedDay: 1,
    dialog: null,
    notes: "",
    rejectionReason: "",
    isSubmitting: false,
    onSelectDay: noop,
    onOpenApprove: noop,
    onOpenReject: noop,
    onCloseDialog: noop,
    onNotesChange: noop,
    onRejectionReasonChange: noop,
    onApprove: noop,
    onReject: noop,
    onRetry: noop,
    onSignOut: noop,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(AdminReviewDetailView, props));
}

test("ready review detail presents only real package, itinerary, and pricing data", () => {
  const html = render();

  assert.match(html, /Back to review dashboard/);
  assert.match(html, /Bali Slow Travel Reset/);
  assert.match(html, /Mina Travels/);
  assert.match(html, /4 Oct 2026/);
  assert.match(html, /Pending review/);
  assert.match(html, /A measured itinerary/);
  assert.match(html, /Arrive and settle in/);
  assert.match(html, /Example Air/);
  assert.match(html, /Market walk/);
  assert.match(html, /Flights/);
  assert.match(html, /\$1,200/);
  assert.match(html, /Components total/);
  assert.match(html, /Approve package/);
  assert.match(html, /Request changes/);
  assert.doesNotMatch(html, /quality score|critical issues|feasibility/i);
});

test("missing cover media renders an honest placeholder without inventing a photo", () => {
  const html = render({ packageDetail: { ...packageDetail, cover_image_url: null } });
  assert.match(html, /Cover image not provided/);
  assert.doesNotMatch(html, /<img/);
});

test("approve and request-change dialogs expose the correct decision controls", () => {
  const approveHtml = render({ dialog: "approve" });
  assert.match(approveHtml, /role="dialog"/);
  assert.match(approveHtml, /Confirm approval/);
  assert.match(approveHtml, /Internal notes/);

  const rejectHtml = render({ dialog: "reject", rejectionReason: "Too short" });
  assert.match(rejectHtml, /Send change request/);
  assert.match(rejectHtml, /Reason for the creator/);
  assert.match(rejectHtml, /Enter at least 10 characters/);
  assert.match(rejectHtml, /disabled=""/);
});

test("loading, unavailable, and conflict states remain actionable", () => {
  assert.match(render({ status: "loading", packageDetail: null }), /aria-busy="true"/);
  assert.match(render({ status: "not-found", packageDetail: null }), /Package not found/);
  assert.match(render({ status: "forbidden", packageDetail: null }), /Administrator access required/);
  assert.match(
    render({ status: "conflict", packageDetail, errorMessage: "Already reviewed" }),
    /Already reviewed/,
  );
  assert.match(render({ status: "error", packageDetail: null }), /Try again/);
});

test("rejection reason validation mirrors the existing API minimum", () => {
  assert.equal(rejectionReasonError("Too short"), "Enter at least 10 characters.");
  assert.equal(rejectionReasonError("Please add clearer inclusions."), "");
});

test("detailFailure maps API statuses to dedicated review states", () => {
  assert.deepEqual(detailFailure({ status: 404, message: "Missing" }), {
    status: "not-found",
    message: "Missing",
  });
  assert.deepEqual(detailFailure({ status: 409, message: "Already reviewed" }), {
    status: "conflict",
    message: "Already reviewed",
  });
});

test("review cover media stays in a bounded crop when uploads are portrait", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
    "utf8",
  );
  assert.match(css, /\.admin-detail-cover__media\s*\{[\s\S]*?height:\s*340px/);
  assert.match(css, /\.admin-detail-cover__media img\s*\{[\s\S]*?object-fit:\s*cover/);
});

test("decision dialogs opt out of the browser's absolute dialog positioning", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
    "utf8",
  );
  assert.match(css, /\.admin-detail-dialog\s*\{[\s\S]*?position:\s*relative/);
});

test("a decided package opened for viewing shows its status, not a generic conflict", () => {
  const html = render({ status: "conflict", packageDetail: { ...packageDetail, status: "approved" } });
  assert.match(html, /Already approved/);
  assert.doesNotMatch(html, /Review already completed/);
  assert.equal(decisionNotice("rejected").title, "Changes already requested");
  assert.equal(decisionNotice("live").title, "Already live");
  assert.deepEqual(decisionNotice("pending_review", "Taken by someone else"), {
    title: "No longer pending review",
    message: "Taken by someone else",
  });
});

test("the previous decision is shown with its reason and internal notes", () => {
  const html = render({
    packageDetail: {
      ...packageDetail,
      status: "rejected",
      latest_approval: {
        decision: "rejected",
        rejection_reason: "Add clearer inclusions.",
        notes: "Second time this creator.",
        reviewed_at: "2026-10-05T01:00:00Z",
      },
    },
  });
  assert.match(html, /Last decision/);
  assert.match(html, /Changes requested/);
  assert.match(html, /Add clearer inclusions\./);
  assert.match(html, /Second time this creator\./);
  assert.match(html, /5 Oct 2026/);
  assert.doesNotMatch(render(), /Last decision|Previous decision/);
});

test("approve and request-changes stay disabled once the package is not pending", () => {
  const html = render({ status: "conflict", packageDetail: { ...packageDetail, status: "rejected" } });
  assert.equal((html.match(/disabled=""/g) ?? []).length >= 2, true);
});

test("the review page shows every uploaded photo, flags unplaced ones, and opens them safely", () => {
  const html = render({
    packageDetail: {
      ...packageDetail,
      cover_image_url: "https://images.example.com/a.jpg",
      media: [
        { media_id: "m1", url: "https://images.example.com/a.jpg", caption: "Rice terraces" },
        { media_id: "m2", url: "https://images.example.com/b.jpg" },
        { media_id: "m3", url: "javascript:alert(1)" },
      ],
      days: [
        { id: "day-1", day_number: 1, title: "Arrive and settle in", summary: "A gentle first day.", media_ids: ["m1"] },
        { id: "day-2", day_number: 2, title: "Ubud at your pace", summary: "Food and craft." },
      ],
    },
  });

  assert.match(html, /<h2 id="admin-detail-photos-title">Photos <span[^>]*>3<\/span><\/h2>/);
  assert.match(html, /href="https:\/\/images\.example\.com\/a\.jpg" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /aria-label="Open photo 2 in a new tab"/);
  assert.match(html, /<b>Cover<\/b>/);
  assert.match(html, /2 photos are not placed on a day or stop\./);
  assert.match(html, /Invalid image address/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, /aria-label="Photos for day 1"/, "day photos appear inside the day panel");
});

test("a package with no uploads says so instead of hiding the photo section", () => {
  const html = render();
  assert.match(html, /Photos <span[^>]*>0<\/span>/);
  assert.match(html, /No photos were uploaded for this package\./);
});
