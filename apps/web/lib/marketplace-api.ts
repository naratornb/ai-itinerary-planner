export type MarketplacePackageSummary = {
  package_id: string;
  title: string;
  destination_country: string | null;
  destination_city: string | null;
  duration_days: number | null;
  base_price_aud: number | null;
  cover_image_url: string | null;
  tags: string[];
  influencer: {
    display_name: string | null;
    instagram_handle: string | null;
    follower_count: number | null;
  } | null;
  published_at: string | null;
};

export type MarketplacePackageDetail = MarketplacePackageSummary & {
  description?: string | null;
  creator?: {
    full_name?: string | null;
    avatar_url?: string | null;
    influencer_profiles?: {
      bio?: string | null;
      instagram_handle?: string | null;
      follower_count?: number | null;
      verified?: boolean | null;
    } | Array<{
      bio?: string | null;
      instagram_handle?: string | null;
      follower_count?: number | null;
      verified?: boolean | null;
    }>;
  } | null;
  media?: Array<{ media_id?: string; url?: string; media_url?: string; is_cover?: boolean }>;
  days?: Array<{ package_day_id?: string; day_number?: number; title?: string; description?: string }>;
  flights?: unknown[];
  hotels?: unknown[];
  activities?: unknown[];
};

type MarketplaceListResponse = { data: MarketplacePackageSummary[] };

function apiBase(apiUrl: string) {
  return apiUrl.replace(/\/$/, "");
}

async function readJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) throw new Error(message);
  return response.json() as Promise<T>;
}

export async function fetchMarketplacePackages(fetcher: typeof fetch, apiUrl: string) {
  const response = await fetcher(`${apiBase(apiUrl)}/marketplace/packages?per_page=100`);
  const payload = await readJson<MarketplaceListResponse>(response, "Unable to load marketplace packages.");
  return payload.data;
}

export async function searchMarketplacePackages(fetcher: typeof fetch, apiUrl: string, query: string) {
  const params = new URLSearchParams({ q: query.trim(), per_page: "100" });
  const response = await fetcher(`${apiBase(apiUrl)}/marketplace/search?${params}`);
  const payload = await readJson<MarketplaceListResponse>(response, "Unable to search marketplace packages.");
  return payload.data;
}

export async function fetchMarketplacePackage(fetcher: typeof fetch, apiUrl: string, packageId: string) {
  const response = await fetcher(`${apiBase(apiUrl)}/marketplace/packages/${encodeURIComponent(packageId)}`);
  if (response.status === 404) throw new Error("Package not found.");
  return readJson<MarketplacePackageDetail>(response, "Unable to load this package.");
}

export function uniqueDestinationSuggestions(packages: MarketplacePackageSummary[]) {
  const suggestions = new Set<string>();
  for (const pkg of packages) {
    if (pkg.destination_country) suggestions.add(pkg.destination_country);
    const city = [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", ");
    if (pkg.destination_city && city) suggestions.add(city);
  }
  return [...suggestions];
}
