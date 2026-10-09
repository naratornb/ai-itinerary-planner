import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchAdminPackageFromSupabase,
  fetchLatestApproval,
  loadAdminPackageForReview,
} from "./admin-package-supabase";

test("admin package fallback maps the existing RLS-protected detail rows", async () => {
  const raw = {
    package_id: "package-1",
    title: "Bali Slow Travel Reset",
    destination_country: "Indonesia",
    destination_city: "Denpasar",
    duration_days: 2,
    base_price_aud: 3000,
    status: "pending_review",
    creator_id: "creator-1",
    created_at: "2026-09-29T01:00:00Z",
    submitted_at: "2026-10-04T12:00:00Z",
    description: "A measured trip.",
    creator: { full_name: "Mina Travels", avatar_url: null, influencer_profiles: [] },
    package_media: [
      { media_id: "media-2", url: "https://images.example.com/second.jpg", is_cover: false, sort_order: 1 },
      { media_id: "media-1", url: "https://images.example.com/cover.jpg", is_cover: true, sort_order: 2 },
    ],
    package_days: [{ id: "day-1", day_number: 1, title: "Arrive", summary: "Settle in", media_ids: null }],
    package_flights: [{
      id: "pf-1",
      flight_id: "flight-1",
      details: {
        airline: "Example Air",
        flight_number: "EA100",
        origin_iata: "BNE",
        destination_iata: "DPS",
        departure_time: "09:15",
        arrival_time: "13:40",
        cabin_class: "Economy",
        price_aud: 1200,
        day_number: 1,
      },
      flights: null,
    }],
    package_hotels: [{
      id: "ph-1",
      hotel_id: "hotel-1",
      nights: 2,
      details: null,
      check_in_day: 1,
      check_out_day: 3,
      hotels: {
        hotel_name: "Ubud Garden Stay",
        star_rating: 4,
        city: "Ubud",
        address: "10 Example Road",
        price_per_night_aud: 700,
        room_type: "Garden Room",
      },
    }],
    package_activities: [{
      id: "pa-1",
      activity_id: "activity-1",
      details: null,
      day_number: 1,
      sequence_order: 2,
      activities: {
        activity_name: "Market walk",
        city: "Ubud",
        duration_hours: 2,
        price_aud: 400,
        description: "Meet local producers.",
        booking_required: true,
      },
    }],
  };
  const client = {
    from(table: string) {
      assert.equal(table, "travel_packages");
      return {
        select(select: string) {
          assert.match(select, /package_flights/);
          return {
            eq(column: string, value: string) {
              assert.equal(column, "package_id");
              assert.equal(value, "package-1");
              return { maybeSingle: async () => ({ data: raw, error: null }) };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  const detail = await fetchAdminPackageFromSupabase(client, "package-1");

  assert.equal(detail?.cover_image_url, "https://images.example.com/cover.jpg");
  assert.equal(detail?.flights[0].airline, "Example Air");
  assert.equal(detail?.hotels[0].hotel_name, "Ubud Garden Stay");
  assert.equal(detail?.activities[0].activity_name, "Market walk");
  assert.deepEqual(detail?.days[0].media_ids, []);
  assert.deepEqual(detail?.pricing, {
    flights_total: 1200,
    hotels_total: 1400,
    activities_total: 400,
    components_total: 3000,
    base_price_aud: 3000,
  });
});

test("admin package fallback distinguishes a missing row from a database error", async () => {
  const clientFor = (result: { data: unknown; error: { message: string } | null }) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  }) as unknown as SupabaseClient;

  assert.equal(
    await fetchAdminPackageFromSupabase(clientFor({ data: null, error: null }), "missing"),
    null,
  );
  await assert.rejects(
    fetchAdminPackageFromSupabase(
      clientFor({ data: null, error: { message: "Database unavailable" } }),
      "package-1",
    ),
    /Database unavailable/,
  );
});

test("review loading uses the RLS fallback only when the owner-scoped endpoint returns 404", async () => {
  let fallbackCalls = 0;
  const fetcher: typeof fetch = async () =>
    Response.json({ message: "Package not found" }, { status: 404 });
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            fallbackCalls += 1;
            return {
              data: {
                package_id: "package-1",
                title: "Admin-visible package",
                duration_days: 1,
                base_price_aud: 100,
                status: "pending_review",
                creator_id: "creator-1",
                created_at: "2026-10-01T00:00:00Z",
                package_media: [],
                package_days: [],
                package_flights: [],
                package_hotels: [],
                package_activities: [],
              },
              error: null,
            };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  const detail = await loadAdminPackageForReview(
    fetcher,
    client,
    "http://localhost:8000",
    "admin-token",
    "package-1",
  );

  assert.equal(detail?.title, "Admin-visible package");
  assert.equal(fallbackCalls, 1);
});

function approvalsClient(result: { data: unknown; error: { message: string } | null } | "throw") {
  const calls: string[] = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: string) => { calls.push(`${column}=${value}`); return chain; },
    order: (column: string, opts: { ascending: boolean }) => { calls.push(`order ${column} ${opts.ascending ? "asc" : "desc"}`); return chain; },
    limit: (n: number) => { calls.push(`limit ${n}`); return chain; },
    maybeSingle: async () => { if (result === "throw") throw new Error("boom"); return result; },
  };
  const client = { from: (table: string) => { calls.push(table); return chain; } } as unknown as SupabaseClient;
  return { client, calls };
}

test("latest approval reads the newest decision for the package", async () => {
  const { client, calls } = approvalsClient({
    data: { approval_id: "a1", package_id: "p1", decision: "rejected", rejection_reason: "Fix pricing", notes: null, reviewed_at: "2026-10-05T01:00:00Z" },
    error: null,
  });
  const approval = await fetchLatestApproval(client, "p1");
  assert.deepEqual(approval, {
    approval_id: "a1",
    package_id: "p1",
    decision: "rejected",
    rejection_reason: "Fix pricing",
    notes: null,
    reviewed_at: "2026-10-05T01:00:00Z",
  });
  assert.deepEqual(calls, ["package_approvals", "package_id=p1", "order reviewed_at desc", "limit 1"]);
});

test("latest approval never blocks the review: errors, missing rows and odd data all read as none", async () => {
  assert.equal(await fetchLatestApproval(approvalsClient({ data: null, error: null }).client, "p1"), null);
  assert.equal(await fetchLatestApproval(approvalsClient({ data: null, error: { message: "denied" } }).client, "p1"), null);
  assert.equal(await fetchLatestApproval(approvalsClient("throw").client, "p1"), null);
  assert.equal(
    await fetchLatestApproval(approvalsClient({ data: { decision: "maybe" }, error: null }).client, "p1"),
    null,
  );
});

test("the RLS fallback attaches the previous decision so admins can see it", async () => {
  const pkg = {
    package_id: "package-1", title: "Decided", duration_days: 1, base_price_aud: 100, status: "rejected",
    creator_id: "creator-1", created_at: "2026-10-01T00:00:00Z",
    package_media: [], package_days: [], package_flights: [], package_hotels: [], package_activities: [],
  };
  const approval = { approval_id: "a1", package_id: "package-1", decision: "rejected", rejection_reason: "Needs work, please revise.", notes: null, reviewed_at: "2026-10-05T01:00:00Z" };
  const client = {
    from(table: string) {
      const data = table === "package_approvals" ? approval : pkg;
      const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data, error: null }) };
      return chain;
    },
  } as unknown as SupabaseClient;
  const fetcher: typeof fetch = async () => Response.json({ message: "Package not found" }, { status: 404 });

  const detail = await loadAdminPackageForReview(fetcher, client, "http://localhost:8000", "t", "package-1");

  assert.equal(detail.latest_approval?.rejection_reason, "Needs work, please revise.");
});
