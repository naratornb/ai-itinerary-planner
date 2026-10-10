import type { SubmittedFeasibility } from "./feasibility-result";
type AuthClient = {
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{
    data: { session: { access_token: string } | null };
    error: { message: string } | null;
  }>;
};

export class CreatorApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "CreatorApiError";
  }
}

async function creatorApiError(response: Response, fallback: string): Promise<CreatorApiError> {
  const body = await response.json().catch(() => null);
  return new CreatorApiError(body?.message || fallback, response.status);
}

export type CreatorPackage = {
  package_id: string;
  title: string;
  destination_country: string;
  destination_city: string;
  duration_days: number;
  base_price_aud: number;
  status: string;
  creator_id: string;
  created_at: string;
  submitted_at?: string | null;
  published_at?: string | null;
  cover_image_url?: string | null;
};

export type CreatorHotelDetail = {
  hotel_id: string | null;
  /** package_hotels row id — unique per stay, so repeat stays at the same
   * hotel keep separate stay groups in the editor. */
  package_component_id?: string | null;
  sequence_order?: number | null;
  hotel_name: string | null;
  star_rating: number | null;
  city: string | null;
  address: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  price_per_night_aud: number | null;
  room_type: string | null;
  check_in_day?: number | null;
  check_out_day?: number | null;
  nights?: number | null;
  notes?: string | null;
  media_ids?: string[];
  source_id?: string | null;
};

export type CreatorFlightDetail = {
  flight_id: string | null;
  package_component_id?: string | null;
  day_number?: number | null;
  sequence_order?: number | null;
  airline: string | null;
  flight_number: string | null;
  origin_iata: string | null;
  destination_iata: string | null;
  departure_datetime?: string | null;
  arrival_datetime?: string | null;
  departure_time?: string | null;
  arrival_time?: string | null;
  duration_minutes?: number | null;
  cabin_class: string | null;
  price_aud: number | null;
  notes?: string | null;
  media_ids?: string[];
  source_id?: string | null;
};

export type CreatorActivityDetail = {
  activity_id: string | null;
  sequence_order: number | null;
  activity_name: string | null;
  activity_date?: string | null;
  city: string | null;
  duration_hours: number | null;
  price_aud: number | null;
  description: string | null;
  booking_required: boolean | null;
  day_number?: number | null;
  start_time?: string | null;
  /** "activity" (default) or "creator_pick" — the editor's type discriminator. */
  item_type?: string | null;
  category?: string | null;
  address?: string | null;
  notes?: string | null;
  media_ids?: string[];
  source_id?: string | null;
};

export type CreatorPackageDay = {
  id: string | null;
  day_number: number | null;
  title: string | null;
  summary: string | null;
  meta?: string | null;
  media_ids?: string[];
};

export type CreatorMediaDetail = {
  media_id: string;
  url: string;
  caption?: string | null;
};

export type CreatorApprovalRecord = {
  approval_id?: string;
  package_id?: string;
  reviewer_id?: string;
  decision: "approved" | "rejected";
  rejection_reason?: string | null;
  reviewed_at?: string | null;
};

export type CreatorPackageDetail = {
  package_id: string;
  title: string;
  duration_days: number;
  base_price_aud?: number;
  destination_city?: string | null;
  destination_country?: string | null;
  description?: string | null;
  max_group_size?: number | null;
  season?: string | null;
  suitable_for?: string | null;
  tags?: string[];
  status?: string;
  flights: CreatorFlightDetail[];
  hotels: CreatorHotelDetail[];
  activities: CreatorActivityDetail[];
  days: CreatorPackageDay[];
  media?: CreatorMediaDetail[];
  latest_approval?: CreatorApprovalRecord | null;
};

type ProfileRow = {
  full_name?: string | null;
  avatar_url?: string | null;
};

type UserMetadata = {
  full_name?: string | null;
  avatar_url?: string | null;
};

export function resolveCreatorProfile(
  profile: ProfileRow | null,
  metadata: UserMetadata,
  email: string,
) {
  const displayName = profile?.full_name || metadata.full_name || email.split("@")[0] || "Creator";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";

  return {
    displayName,
    initials,
    avatarUrl: profile?.avatar_url || metadata.avatar_url || null,
  };
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  live: "Live",
  archived: "Archived",
  not_editable: "No longer editable",
};

export function formatCreatorPackage(pkg: CreatorPackage) {
  const createdDate = new Date(pkg.created_at);
  return {
    id: pkg.package_id,
    name: pkg.title,
    duration: `${pkg.duration_days} day${pkg.duration_days === 1 ? "" : "s"}`,
    created: Number.isFinite(createdDate.getTime())
      ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(createdDate)
      : "—",
    destination: [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", "),
    price: new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0,
    }).format(pkg.base_price_aud),
    status: STATUS_LABELS[pkg.status] ?? pkg.status,
    statusKey: pkg.status,
    rowAction: pkg.status === "draft" || pkg.status === "rejected"
      ? "Edit"
      : pkg.status === "approved"
        ? "Preview"
        : "View",
  };
}

type PackageListResponse = {
  data: CreatorPackage[];
};

export async function signInWithEmail(
  auth: AuthClient,
  email: string,
  password: string,
) {
  const { data, error } = await auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error("Invalid email or password.");
  return data.session;
}

export async function fetchOwnPackages(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/packages?per_page=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (!response.ok) throw new Error("Unable to load your packages. Please try again.");

  const payload = (await response.json()) as PackageListResponse;
  return payload.data;
}

// Mirrors FlightInput/HotelInput/ActivityInput in apps/api/app/packages/schemas.py.
export type FlightInput = {
  origin_iata: string;              // exactly 3 chars
  destination_iata: string;         // exactly 3 chars
  airline: string;
  flight_number?: string | null;
  // Legacy dated inventory fields remain readable, but package templates use
  // relative days and clock times because the traveller chooses the dates.
  departure_datetime?: string | null;
  arrival_datetime?: string | null;
  departure_time?: string | null;
  arrival_time?: string | null;
  duration_minutes?: number | null;
  cabin_class?: string | null;
  price_aud?: number | null;
  day_number?: number;
  sequence_order?: number;
  notes?: string | null;
  media_ids?: string[];
  source_id?: string | null;
};

export type HotelInput = {
  hotel_name: string;
  star_rating?: number | null;      // 1–5
  city: string;
  address?: string | null;
  check_in_date?: string | null;     // legacy dated package rows
  check_out_date?: string | null;    // legacy dated package rows
  price_per_night_aud?: number | null;
  room_type?: string | null;
  check_in_day?: number;
  check_out_day?: number;
  nights?: number;
  sequence_order?: number;
  notes?: string | null;
  media_ids?: string[];
  source_id?: string | null;
};

export type ActivityInput = {
  activity_name: string;
  activity_date?: string | null;     // legacy dated package rows
  city: string;
  duration_hours?: number | null;
  price_aud?: number | null;
  description?: string | null;
  booking_required?: boolean | null;
  day_number?: number;
  sequence_order?: number;
  start_time?: string | null;
  /** "activity" (default) or "creator_pick". */
  item_type?: string | null;
  category?: string | null;
  address?: string | null;
  notes?: string | null;
  media_ids?: string[];
  source_id?: string | null;
};

export type PackageDayInput = {
  day_number: number;
  title: string | null;
  summary: string | null;
  meta?: string | null;
  media_ids?: string[];
};

export type CreatePackageInput = {
  title: string;
  description: string;
  destination_country: string;
  destination_city: string;
  duration_days: number;
  base_price_aud: number;
  max_group_size?: number | null;
  // Accepted by POST /packages (TravelPackageCreate.tags) — the wizard sends
  // the picked vibe ids so the package keeps them past session storage.
  tags?: string[];
  flights?: FlightInput[];
  hotels?: HotelInput[];
  activities?: ActivityInput[];
  days?: PackageDayInput[];
};

export type UpdatePackageInput = {
  title?: string;
  // Already accepted by PUT /packages/{id} (TravelPackageUpdate in
  // apps/api/app/packages/schemas.py) — just unused by any caller before.
  description?: string;
  base_price_aud?: number;
  destination_country?: string;
  destination_city?: string;
  duration_days?: number;
  max_group_size?: number;
  tags?: string[];
  days?: PackageDayInput[];
  flights?: FlightInput[];
  hotels?: HotelInput[];
  activities?: ActivityInput[];
};

export async function createPackage(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  input: CreatePackageInput,
) {
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/packages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (!response.ok) throw new Error("Unable to create this package. Please try again.");
  return response.json() as Promise<CreatorPackageDetail>;
}

export async function fetchOwnPackage(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/packages/${encodeURIComponent(packageId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (response.status === 404) throw new Error("Package not found.");
  if (!response.ok) throw new Error("Unable to load this package. Please try again.");
  return response.json() as Promise<CreatorPackageDetail>;
}

export async function updatePackage(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
  input: UpdatePackageInput,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/packages/${encodeURIComponent(packageId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(input),
    },
  );
  if (response.status === 401) throw new CreatorApiError("Your session expired. Please sign in again.", 401);
  if (!response.ok) {
    throw await creatorApiError(response, "Unable to save this package. Please try again.");
  }
  return response.json() as Promise<CreatorPackageDetail>;
}

export async function deletePackage(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/packages/${encodeURIComponent(packageId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (response.status === 204 || response.ok) return;
  // e.g. 409 PACKAGE_NOT_DELETABLE if the status changed since the page loaded.
  const body = await response.json().catch(() => null);
  throw new Error(body?.message || "Unable to delete this package. Please try again.");
}

export async function publishPackage(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/approvals/${encodeURIComponent(packageId)}/publish`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401) {
    throw new CreatorApiError("Your session expired. Please sign in again.", 401);
  }
  if (!response.ok) {
    throw await creatorApiError(response, "Unable to publish this package. Please try again.");
  }
  return response.json() as Promise<CreatorPackage>;
}

// Mirrors MediaItem/MediaUploadResponse in apps/api/app/media/schemas.py.
export type PackageMedia = {
  media_id: string;
  package_id: string;
  media_type: string;
  url: string;
  caption?: string | null;
  is_cover?: boolean;
  sort_order?: number;
};

export async function listPackageMedia(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/media/${encodeURIComponent(packageId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (!response.ok) throw new Error("Unable to load photos for this package.");
  const payload = (await response.json()) as { data: PackageMedia[] };
  return payload.data;
}

export async function uploadPackageMedia(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
  file: File,
  isCover = false,
) {
  const body = new FormData();
  body.append("package_id", packageId);
  body.append("file", file);
  // Omitted when false: POST /media/upload already defaults is_cover to
  // false (apps/api/app/media/router.py), so this only changes behavior
  // for a caller that explicitly opts in.
  if (isCover) body.append("is_cover", "true");
  // No Content-Type header: the browser has to set the multipart boundary.
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/media/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (!response.ok) throw new Error("Unable to upload this photo. Please try again.");
  return response.json() as Promise<PackageMedia>;
}

export type SubmitPackageResponse = {
  package_id: string;
  status: string;
};

export class SubmitPackageError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "SubmitPackageError";
    this.status = status;
    this.code = code;
  }
}

export async function submitPackage(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  packageId: string,
  submissionNote?: string,
  feasibilityResult?: SubmittedFeasibility | null,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/packages/${encodeURIComponent(packageId)}/submit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        ...(submissionNote ? { submission_note: submissionNote } : {}),
        // The result the editor produced at submission, for the backend to store for admin review.
        ...(feasibilityResult ? { feasibility_result: feasibilityResult } : {}),
      }),
    },
  );
  if (response.status === 401) throw new SubmitPackageError("Your session expired. Please sign in again.", 401);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.message
      || (response.status === 404 ? "This package can't be submitted." : null)
      || "Something went wrong. Please try again later.";
    throw new SubmitPackageError(message, response.status, body?.error_code);
  }
  return response.json() as Promise<SubmitPackageResponse>;
}

export async function deletePackageMedia(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
  mediaId: string,
) {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/media/${encodeURIComponent(mediaId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (!response.ok) throw new Error("Unable to remove this photo. Please try again.");
}
