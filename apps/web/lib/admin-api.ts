import type { CreatorPackageDetail } from "./creator-api";

export type ApprovalSort = "submitted_at_asc" | "submitted_at_desc";

export type AdminApprovalPackage = {
  package_id: string;
  title: string;
  destination_country: string | null;
  destination_city: string | null;
  duration_days: number | null;
  base_price_aud: number | null;
  status: string;
  creator_id: string;
  created_at: string;
  submitted_at: string | null;
  published_at?: string | null;
  cover_image_url?: string | null;
  vibes?: string[];
  season?: string | null;
};

export type ApprovalListResponse = {
  data: AdminApprovalPackage[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
};

export type AdminUser = {
  id: string | null;
  username: string;
  email: string;
};

export type AdminPackageCreator = {
  full_name: string;
  avatar_url: string | null;
  influencer_profiles: Array<{
    bio?: string | null;
    instagram_handle?: string | null;
    tiktok_handle?: string | null;
    follower_count?: number | null;
    verified?: boolean;
  }>;
};

export type AdminApprovalRecord = {
  approval_id?: string;
  package_id?: string;
  reviewer_id?: string;
  decision: "approved" | "rejected";
  rejection_reason?: string | null;
  reviewed_at?: string;
};

export type AdminPackagePricing = {
  flights_total: number;
  hotels_total: number;
  activities_total: number;
  components_total: number;
  base_price_aud: number | null;
};

export type AdminPackageDetail = Omit<
  CreatorPackageDetail,
  "destination_city" | "destination_country" | "base_price_aud" | "status"
> & {
  destination_city: string | null;
  destination_country: string | null;
  base_price_aud: number | null;
  status: string;
  creator_id: string;
  created_at: string;
  submitted_at?: string | null;
  published_at?: string | null;
  cover_image_url?: string | null;
  vibes?: string[];
  creator?: AdminPackageCreator | null;
  latest_approval?: AdminApprovalRecord | null;
  pricing?: AdminPackagePricing | null;
};

export type AdminDecisionResponse = {
  package: AdminApprovalPackage;
  approval: AdminApprovalRecord;
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly kind: "unauthenticated" | "forbidden" | "request",
    public readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

function apiBase(apiUrl: string): string {
  return apiUrl.replace(/\/$/, "");
}

function errorKind(status: number): AdminApiError["kind"] {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  return "request";
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return fallback;
  const message = "message" in body ? body.message : "error" in body ? body.error : null;
  return typeof message === "string" && message.trim() ? message : fallback;
}

async function checkedJson(response: Response, fallback: string): Promise<unknown> {
  if (!response.ok) {
    throw new AdminApiError(
      await responseMessage(response, fallback),
      errorKind(response.status),
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new AdminApiError(fallback, "request", response.status);
  }
}

function isApprovalListResponse(value: unknown): value is ApprovalListResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as { data?: unknown; meta?: unknown };
  if (!Array.isArray(body.data) || !body.meta || typeof body.meta !== "object") return false;
  const meta = body.meta as Record<string, unknown>;
  return ["total", "page", "per_page", "total_pages"].every(
    (key) => typeof meta[key] === "number",
  );
}

function isAdminPackageDetail(value: unknown): value is AdminPackageDetail {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.package_id === "string"
    && typeof item.title === "string"
    && Array.isArray(item.flights)
    && Array.isArray(item.hotels)
    && Array.isArray(item.activities)
    && Array.isArray(item.days);
}

function isDecisionResponse(value: unknown): value is AdminDecisionResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as { package?: unknown; approval?: unknown };
  if (!item.package || typeof item.package !== "object") return false;
  if (!item.approval || typeof item.approval !== "object") return false;
  const pkg = item.package as Record<string, unknown>;
  const approval = item.approval as Record<string, unknown>;
  return typeof pkg.package_id === "string"
    && (approval.decision === "approved" || approval.decision === "rejected");
}

export async function fetchPendingApprovals(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
  query: { page: number; perPage: number; sort: ApprovalSort },
): Promise<ApprovalListResponse> {
  const params = new URLSearchParams({
    page: String(query.page),
    per_page: String(query.perPage),
    sort: query.sort,
  });
  const response = await fetcher(`${apiBase(apiUrl)}/approvals?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await checkedJson(response, "Unable to load the review queue. Please try again.");

  if (!isApprovalListResponse(body)) {
    throw new AdminApiError(
      "Unable to load the review queue. Please try again.",
      "request",
      response.status,
    );
  }
  return body;
}

export async function hasAdminApprovalAccess(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
): Promise<boolean> {
  try {
    await fetchPendingApprovals(fetcher, apiUrl, token, {
      page: 1,
      perPage: 1,
      sort: "submitted_at_asc",
    });
    return true;
  } catch (error) {
    if (error instanceof AdminApiError && error.kind === "forbidden") return false;
    throw error;
  }
}

export async function fetchAdminUsers(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
): Promise<AdminUser[]> {
  const response = await fetcher(`${apiBase(apiUrl)}/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await checkedJson(response, "Unable to load creator names.");

  if (!body || typeof body !== "object" || !("users" in body) || !Array.isArray(body.users)) {
    throw new AdminApiError("Unable to load creator names.", "request", response.status);
  }

  return body.users.map((user: unknown) => {
    const item = user && typeof user === "object" ? (user as Record<string, unknown>) : {};
    return {
      id: typeof item.id === "string" ? item.id : null,
      username: typeof item.username === "string" ? item.username : "",
      email: typeof item.email === "string" ? item.email : "",
    };
  });
}

export async function fetchAdminPackage(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
  packageId: string,
): Promise<AdminPackageDetail> {
  const response = await fetcher(`${apiBase(apiUrl)}/packages/${encodeURIComponent(packageId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await checkedJson(response, "Unable to load this package for review.");
  if (!isAdminPackageDetail(body)) {
    throw new AdminApiError("Unable to load this package for review.", "request", response.status);
  }
  return body;
}

async function postDecision(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
  packageId: string,
  action: "approve" | "reject",
  payload: Record<string, string>,
): Promise<AdminDecisionResponse> {
  const response = await fetcher(
    `${apiBase(apiUrl)}/approvals/${encodeURIComponent(packageId)}/${action}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await checkedJson(response, `Unable to ${action} this package.`);
  if (!isDecisionResponse(body)) {
    throw new AdminApiError(`Unable to ${action} this package.`, "request", response.status);
  }
  return body;
}

export function approveAdminPackage(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
  packageId: string,
  notes: string,
): Promise<AdminDecisionResponse> {
  return postDecision(
    fetcher,
    apiUrl,
    token,
    packageId,
    "approve",
    notes.trim() ? { notes: notes.trim() } : {},
  );
}

export function rejectAdminPackage(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
  packageId: string,
  rejectionReason: string,
  notes: string,
): Promise<AdminDecisionResponse> {
  return postDecision(fetcher, apiUrl, token, packageId, "reject", {
    rejection_reason: rejectionReason.trim(),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
  });
}
