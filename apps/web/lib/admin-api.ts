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

