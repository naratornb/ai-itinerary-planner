import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchOwnPackages,
  fetchDashboardStats,
  formatDashboardStats,
  formatCreatorPackage,
  resolveCreatorProfile,
  signInWithEmail,
} from "./creator-api";

test("signInWithEmail returns the authenticated session", async () => {
  const session = { access_token: "access-token" };
  const auth = {
    signInWithPassword: async (credentials: { email: string; password: string }) => {
      assert.deepEqual(credentials, {
        email: "creator@example.com",
        password: "Password123!",
      });
      return { data: { session }, error: null };
    },
  };

  assert.equal(
    await signInWithEmail(auth, "creator@example.com", "Password123!"),
    session,
  );
});

test("signInWithEmail reports rejected credentials", async () => {
  const auth = {
    signInWithPassword: async () => ({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    }),
  };

  await assert.rejects(
    signInWithEmail(auth, "creator@example.com", "wrong-password"),
    /Invalid email or password/,
  );
});

test("fetchOwnPackages sends the Supabase token to the packages API", async () => {
  const responseBody = {
    data: [
      {
        package_id: "package-1",
        title: "Tokyo food tour",
        destination_country: "Japan",
        destination_city: "Tokyo",
        duration_days: 7,
        base_price_aud: 3200,
        status: "draft",
        creator_id: "creator-1",
        created_at: "2026-08-20T00:00:00Z",
      },
    ],
    meta: { total: 1, page: 1, per_page: 20, total_pages: 1 },
  };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://localhost:8000/packages?per_page=100");
    assert.deepEqual(init?.headers, { Authorization: "Bearer access-token" });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  assert.deepEqual(
    await fetchOwnPackages(fetcher, "http://localhost:8000/", "access-token"),
    responseBody.data,
  );
});

test("fetchOwnPackages identifies an expired login", async () => {
  const fetcher: typeof fetch = async () => new Response("{}", { status: 401 });

  await assert.rejects(
    fetchOwnPackages(fetcher, "http://localhost:8000", "expired-token"),
    /sign in again/i,
  );
});

test("formatCreatorPackage converts API fields for the dashboard", () => {
  assert.deepEqual(
    formatCreatorPackage({
      package_id: "package-1",
      title: "Tokyo food tour",
      destination_country: "Japan",
      destination_city: "Tokyo",
      duration_days: 7,
      base_price_aud: 3200,
      status: "pending_review",
      creator_id: "creator-1",
      created_at: "2026-08-20T00:00:00Z",
    }),
    {
      id: "package-1",
      name: "Tokyo food tour",
      duration: "7 days",
      destination: "Tokyo, Japan",
      price: "$3,200",
      status: "Under review",
      statusKey: "pending_review",
      rowAction: "View",
    },
  );
});

test("formatCreatorPackage uses a concise edit action for drafts", () => {
  const formatted = formatCreatorPackage({
    package_id: "package-1",
    title: "Draft trip",
    destination_country: "Peru",
    destination_city: "Cusco",
    duration_days: 8,
    base_price_aud: 3900,
    status: "draft",
    creator_id: "creator-1",
    created_at: "2026-08-20T00:00:00Z",
  });

  assert.equal(formatted.rowAction, "Edit");
});

test("resolveCreatorProfile prefers the database profile", () => {
  assert.deepEqual(
    resolveCreatorProfile(
      { full_name: "Mia Tanaka", avatar_url: "https://example.com/mia.jpg" },
      { full_name: "Fallback Name" },
      "mia.influencer@seed.local",
    ),
    {
      displayName: "Mia Tanaka",
      initials: "MT",
      avatarUrl: "https://example.com/mia.jpg",
    },
  );
});

test("resolveCreatorProfile falls back to auth metadata and initials", () => {
  assert.deepEqual(
    resolveCreatorProfile(null, { full_name: "Mia Tanaka" }, "mia@example.com"),
    { displayName: "Mia Tanaka", initials: "MT", avatarUrl: null },
  );
});

test("formatDashboardStats uses dashes when booking data is unavailable", () => {
  assert.deepEqual(
    formatDashboardStats({
      packageCount: 3,
      bookingCount: null,
      commissionRate: null,
      commissionAud: null,
    }),
    [
      { label: "Packages", value: "3", sub: "All your packages" },
      { label: "Bookings", value: "—", sub: "Not available yet" },
      { label: "Commission rate", value: "—", sub: "Not available yet" },
      { label: "Your commission", value: "—", sub: "Available after bookings" },
    ],
  );
});

test("formatDashboardStats formats a future stats API response", () => {
  const cards = formatDashboardStats({
    packageCount: 3,
    bookingCount: 20,
    commissionRate: 0.2,
    commissionAud: 14800,
  });

  assert.equal(cards[1]?.value, "20");
  assert.equal(cards[2]?.value, "20%");
  assert.equal(cards[3]?.value, "$14,800");
});

test("fetchDashboardStats maps the future dashboard stats endpoint", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://localhost:8000/dashboard/stats");
    assert.deepEqual(init?.headers, { Authorization: "Bearer access-token" });
    return new Response(JSON.stringify({
      package_count: 3,
      booking_count: 20,
      commission_rate: 0.2,
      commission_aud: 14800,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  assert.deepEqual(
    await fetchDashboardStats(fetcher, "http://localhost:8000/", "access-token"),
    {
      packageCount: 3,
      bookingCount: 20,
      commissionRate: 0.2,
      commissionAud: 14800,
    },
  );
});
