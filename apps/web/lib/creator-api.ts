type AuthClient = {
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{
    data: { session: unknown | null };
    error: { message: string } | null;
  }>;
};

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
  hotel_name: string | null;
  star_rating: number | null;
  city: string | null;
  address: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  price_per_night_aud: number | null;
  room_type: string | null;
};

export type CreatorFlightDetail = {
  flight_id: string | null;
  airline: string | null;
  flight_number: string | null;
  origin_iata: string | null;
  destination_iata: string | null;
  departure_datetime: string | null;
  arrival_datetime: string | null;
  cabin_class: string | null;
  price_aud: number | null;
};

export type CreatorActivityDetail = {
  activity_id: string | null;
  sequence_order: number | null;
  activity_name: string | null;
  activity_date: string | null;
  city: string | null;
  duration_hours: number | null;
  price_aud: number | null;
  description: string | null;
  booking_required: boolean | null;
};

export type CreatorPackageDay = {
  id: string | null;
  day_number: number | null;
  title: string | null;
  summary: string | null;
};

export type CreatorPackageDetail = {
  package_id: string;
  title: string;
  duration_days: number;
  destination_city?: string | null;
  destination_country?: string | null;
  flights: CreatorFlightDetail[];
  hotels: CreatorHotelDetail[];
  activities: CreatorActivityDetail[];
  days: CreatorPackageDay[];
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

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  live: "Live",
  archived: "Archived",
};

export function formatCreatorPackage(pkg: CreatorPackage) {
  return {
    id: pkg.package_id,
    name: pkg.title,
    duration: `${pkg.duration_days} day${pkg.duration_days === 1 ? "" : "s"}`,
    destination: [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", "),
    price: new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0,
    }).format(pkg.base_price_aud),
    status: STATUS_LABELS[pkg.status] ?? pkg.status,
    statusKey: pkg.status,
    rowAction: pkg.status === "draft" || pkg.status === "rejected" ? "Edit" : "View",
  };
}

type PackageListResponse = {
  data: CreatorPackage[];
};

export type DashboardStats = {
  packageCount: number;
  bookingCount: number | null;
  commissionRate: number | null;
  commissionAud: number | null;
};

type DashboardStatsResponse = {
  package_count: number;
  booking_count: number | null;
  commission_rate: number | null;
  commission_aud: number | null;
};

export function formatDashboardStats(stats: DashboardStats) {
  const unavailable = "Not available yet";
  return [
    { label: "Packages", value: String(stats.packageCount), sub: "All your packages" },
    {
      label: "Bookings",
      value: stats.bookingCount === null ? "—" : String(stats.bookingCount),
      sub: stats.bookingCount === null ? unavailable : "Confirmed bookings",
    },
    {
      label: "Commission rate",
      value: stats.commissionRate === null
        ? "—"
        : new Intl.NumberFormat("en-AU", { style: "percent", maximumFractionDigits: 1 }).format(stats.commissionRate),
      sub: stats.commissionRate === null ? unavailable : "Current rate",
    },
    {
      label: "Your commission",
      value: stats.commissionAud === null
        ? "—"
        : new Intl.NumberFormat("en-AU", {
          style: "currency",
          currency: "AUD",
          maximumFractionDigits: 0,
        }).format(stats.commissionAud),
      sub: stats.commissionAud === null ? "Available after bookings" : "Total earned",
    },
  ];
}

export async function fetchDashboardStats(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string,
): Promise<DashboardStats> {
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/dashboard/stats`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Unable to load dashboard statistics.");
  const payload = (await response.json()) as DashboardStatsResponse;
  return {
    packageCount: payload.package_count,
    bookingCount: payload.booking_count,
    commissionRate: payload.commission_rate,
    commissionAud: payload.commission_aud,
  };
}

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
  departure_datetime: string;
  arrival_datetime: string;
  cabin_class?: string | null;
  price_aud?: number | null;
};

export type HotelInput = {
  hotel_name: string;
  star_rating?: number | null;      // 1–5
  city: string;
  address?: string | null;
  check_in_date: string;            // YYYY-MM-DD
  check_out_date: string;           // YYYY-MM-DD
  price_per_night_aud?: number | null;
  room_type?: string | null;
};

export type ActivityInput = {
  activity_name: string;
  activity_date: string;            // YYYY-MM-DD
  city: string;
  duration_hours?: number | null;
  price_aud?: number | null;
  description?: string | null;
  booking_required?: boolean | null;
};

export type PackageDayInput = {
  day_number: number;
  title: string | null;
  summary: string | null;
};

export type CreatePackageInput = {
  title: string;
  description: string;
  destination_country: string;
  destination_city: string;
  duration_days: number;
  base_price_aud: number;
  max_group_size?: number | null;
  flights?: FlightInput[];
  hotels?: HotelInput[];
  activities?: ActivityInput[];
  days?: PackageDayInput[];
};

export type UpdatePackageInput = {
  title?: string;
  base_price_aud?: number;
  days?: PackageDayInput[];
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
  return response.json() as Promise<{ package_id: string }>;
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
  if (response.status === 401) throw new Error("Your session expired. Please sign in again.");
  if (!response.ok) {
    // e.g. 409 PACKAGE_NOT_EDITABLE on a submitted package — "try again" would lie.
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || "Unable to save this package. Please try again.");
  }
  return response.json() as Promise<{ package_id: string }>;
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
) {
  const body = new FormData();
  body.append("package_id", packageId);
  body.append("file", file);
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
