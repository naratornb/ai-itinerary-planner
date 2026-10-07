import assert from "node:assert/strict";
import test from "node:test";

import {
  AdminApiError,
  approveAdminPackage,
  fetchAdminPackage,
  fetchAdminUsers,
  fetchPendingApprovals,
  hasAdminApprovalAccess,
  rejectAdminPackage,
} from "./admin-api";

const approvalResponse = {
  data: [
    {
      package_id: "package-1",
      title: "Bali Slow Travel Reset",
      destination_country: "Indonesia",
      destination_city: "Denpasar",
      duration_days: 10,
      base_price_aud: 3150,
      status: "pending_review",
      creator_id: "creator-1",
      created_at: "2026-09-29T01:00:00Z",
      submitted_at: "2026-10-01T02:00:00Z",
      published_at: null,
      cover_image_url: null,
      vibes: ["slow travel"],
      season: null,
    },
  ],
  meta: { total: 21, page: 2, per_page: 20, total_pages: 2 },
};

test("fetchPendingApprovals sends only the supported pagination and sort query", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(
      String(input),
      "http://localhost:8000/approvals?page=2&per_page=20&sort=submitted_at_desc",
    );
    assert.deepEqual(init?.headers, { Authorization: "Bearer access-token" });
    return Response.json(approvalResponse);
  };

  const result = await fetchPendingApprovals(
    fetcher,
    "http://localhost:8000/",
    "access-token",
    { page: 2, perPage: 20, sort: "submitted_at_desc" },
  );

  assert.deepEqual(result, approvalResponse);
});

for (const [status, kind] of [
  [401, "unauthenticated"],
  [403, "forbidden"],
  [503, "request"],
] as const) {
  test(`fetchPendingApprovals classifies ${status} responses as ${kind}`, async () => {
    const fetcher: typeof fetch = async () =>
      Response.json({ message: "Request failed" }, { status });

    await assert.rejects(
      fetchPendingApprovals(fetcher, "http://localhost:8000", "token", {
        page: 1,
        perPage: 20,
        sort: "submitted_at_asc",
      }),
      (error: unknown) => {
        assert.ok(error instanceof AdminApiError);
        assert.equal(error.kind, kind);
        assert.equal(error.status, status);
        return true;
      },
    );
  });
}

test("fetchPendingApprovals converts malformed success payloads to a friendly request error", async () => {
  const fetcher: typeof fetch = async () =>
    new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    fetchPendingApprovals(fetcher, "http://localhost:8000", "token", {
      page: 1,
      perPage: 20,
      sort: "submitted_at_asc",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AdminApiError);
      assert.equal(error.kind, "request");
      assert.equal(error.status, 200);
      assert.match(error.message, /review queue/i);
      return true;
    },
  );
});

test("fetchAdminUsers requests the existing users endpoint and keeps label fields only", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://localhost:8000/users");
    assert.deepEqual(init?.headers, { Authorization: "Bearer access-token" });
    return Response.json({
      users: [
        {
          id: "creator-1",
          username: "Mina Travels",
          email: "mina@example.com",
          role: "influencer",
          status: "active",
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
    });
  };

  assert.deepEqual(
    await fetchAdminUsers(fetcher, "http://localhost:8000/", "access-token"),
    [{ id: "creator-1", username: "Mina Travels", email: "mina@example.com" }],
  );
});

test("hasAdminApprovalAccess recognizes an administrator through the approvals endpoint", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(
      String(input),
      "http://localhost:8000/approvals?page=1&per_page=1&sort=submitted_at_asc",
    );
    assert.deepEqual(init?.headers, { Authorization: "Bearer admin-token" });
    return Response.json({ ...approvalResponse, meta: { ...approvalResponse.meta, page: 1, per_page: 1 } });
  };

  assert.equal(
    await hasAdminApprovalAccess(fetcher, "http://localhost:8000", "admin-token"),
    true,
  );
});

test("hasAdminApprovalAccess sends a non-admin to the creator workspace", async () => {
  const fetcher: typeof fetch = async () =>
    Response.json({ message: "Administrator access required" }, { status: 403 });

  assert.equal(
    await hasAdminApprovalAccess(fetcher, "http://localhost:8000", "creator-token"),
    false,
  );
});

test("hasAdminApprovalAccess does not hide authentication or network failures", async () => {
  const fetcher: typeof fetch = async () =>
    Response.json({ message: "Service unavailable" }, { status: 503 });

  await assert.rejects(
    hasAdminApprovalAccess(fetcher, "http://localhost:8000", "admin-token"),
    (error: unknown) => error instanceof AdminApiError && error.kind === "request",
  );
});

const packageDetail = {
  ...approvalResponse.data[0],
  description: "A measured ten-day itinerary through Bali.",
  max_group_size: 8,
  tags: ["slow travel"],
  flights: [],
  hotels: [],
  activities: [],
  days: [],
  media: [],
  creator: {
    full_name: "Mina Travels",
    avatar_url: null,
    influencer_profiles: [],
  },
  latest_approval: null,
  pricing: {
    flights_total: 1200,
    hotels_total: 1500,
    activities_total: 450,
    components_total: 3150,
    base_price_aud: 3150,
  },
};

test("fetchAdminPackage loads the existing package detail endpoint", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://localhost:8000/packages/package%2F1");
    assert.deepEqual(init?.headers, { Authorization: "Bearer access-token" });
    return Response.json(packageDetail);
  };

  assert.deepEqual(
    await fetchAdminPackage(fetcher, "http://localhost:8000/", "access-token", "package/1"),
    packageDetail,
  );
});

test("approveAdminPackage posts optional internal notes to the existing approval endpoint", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://localhost:8000/approvals/package%2F1/approve");
    assert.equal(init?.method, "POST");
    assert.deepEqual(init?.headers, {
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    });
    assert.equal(init?.body, JSON.stringify({ notes: "Price checked." }));
    return Response.json({ package: approvalResponse.data[0], approval: { decision: "approved" } });
  };

  const result = await approveAdminPackage(
    fetcher,
    "http://localhost:8000/",
    "access-token",
    "package/1",
    "Price checked.",
  );
  assert.equal(result.package.status, "pending_review");
});

test("rejectAdminPackage sends the creator-facing reason and separate internal notes", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "http://localhost:8000/approvals/package-1/reject");
    assert.equal(init?.method, "POST");
    assert.equal(
      init?.body,
      JSON.stringify({
        rejection_reason: "Please clarify which transfers are included.",
        notes: "Pricing needs another pass.",
      }),
    );
    return Response.json({ package: approvalResponse.data[0], approval: { decision: "rejected" } });
  };

  await rejectAdminPackage(
    fetcher,
    "http://localhost:8000",
    "access-token",
    "package-1",
    "Please clarify which transfers are included.",
    "Pricing needs another pass.",
  );
});

test("package review requests preserve 404 and 409 responses for dedicated UI states", async () => {
  const notFound: typeof fetch = async () =>
    Response.json({ message: "Package not found" }, { status: 404 });
  const conflict: typeof fetch = async () =>
    Response.json({ message: "Package has already been reviewed" }, { status: 409 });

  await assert.rejects(
    fetchAdminPackage(notFound, "http://localhost:8000", "token", "missing"),
    (error: unknown) => error instanceof AdminApiError && error.status === 404,
  );
  await assert.rejects(
    approveAdminPackage(conflict, "http://localhost:8000", "token", "package-1", ""),
    (error: unknown) => error instanceof AdminApiError && error.status === 409,
  );
});
