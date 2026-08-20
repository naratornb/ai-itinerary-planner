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
