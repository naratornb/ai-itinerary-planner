import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreatorActivityDetail,
  CreatorFlightDetail,
  CreatorHotelDetail,
  CreatorMediaDetail,
  CreatorPackageDay,
} from "./creator-api";
import {
  AdminApiError,
  fetchAdminPackage,
  type AdminPackageCreator,
  type AdminPackageDetail,
} from "./admin-api";

const ADMIN_DETAIL_SELECT = `
  *,
  creator:profiles!creator_id(
    full_name,
    avatar_url,
    influencer_profiles(bio,instagram_handle,tiktok_handle,follower_count,verified)
  ),
  package_media(*),
  package_days(*),
  package_flights(*,flights(*)),
  package_hotels(*,hotels(*)),
  package_activities(*,activities(*))
`;

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(asRow) : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sourceFor(row: Row, relation: "flights" | "hotels" | "activities"): Row {
  const snapshot = asRow(row.details);
  return Object.keys(snapshot).length ? snapshot : asRow(row[relation]);
}

function mapFlights(value: unknown): CreatorFlightDetail[] {
  return asRows(value).map((row, index) => {
    const source = sourceFor(row, "flights");
    const snapshot = Object.keys(asRow(row.details)).length > 0;
    return {
      flight_id: nullableString(row.flight_id),
      sequence_order: nullableNumber(source.sequence_order) ?? nullableNumber(row.sequence_order) ?? index + 1,
      origin_iata: nullableString(source.origin_iata ?? source.origin),
      destination_iata: nullableString(source.destination_iata ?? source.destination),
      airline: nullableString(source.airline),
      flight_number: nullableString(source.flight_number),
      departure_datetime: nullableString(source.departure_datetime),
      arrival_datetime: nullableString(source.arrival_datetime),
      departure_time: nullableString(source.departure_time),
      arrival_time: nullableString(source.arrival_time),
      duration_minutes: nullableNumber(source.duration_minutes),
      cabin_class: nullableString(source.cabin_class),
      price_aud: nullableNumber(source.price_aud),
      day_number: nullableNumber(source.day_number) ?? nullableNumber(row.day_number),
      notes: nullableString(snapshot ? source.notes : row.notes),
      media_ids: snapshot ? stringArray(source.media_ids) : [],
      source_id: nullableString(source.source_id),
    };
  });
}

function mapHotels(value: unknown): Array<CreatorHotelDetail & { nights: number }> {
  return asRows(value).map((row, index) => {
    const source = sourceFor(row, "hotels");
    const snapshot = Object.keys(asRow(row.details)).length > 0;
    return {
      hotel_id: nullableString(row.hotel_id),
      sequence_order: nullableNumber(source.sequence_order) ?? index + 1,
      hotel_name: nullableString(source.hotel_name),
      star_rating: nullableNumber(source.star_rating),
      city: nullableString(source.city),
      address: nullableString(source.address),
      check_in_date: nullableString(source.check_in_date ?? row.check_in_date),
      check_out_date: nullableString(source.check_out_date ?? row.check_out_date),
      check_in_day: nullableNumber(source.check_in_day) ?? nullableNumber(row.check_in_day),
      check_out_day: nullableNumber(source.check_out_day) ?? nullableNumber(row.check_out_day),
      nights: numberValue(row.nights),
      price_per_night_aud: nullableNumber(source.price_per_night_aud),
      room_type: nullableString(source.room_type),
      notes: nullableString(snapshot ? source.notes : row.notes),
      media_ids: snapshot ? stringArray(source.media_ids) : [],
      source_id: nullableString(source.source_id),
    };
  }).sort((left, right) =>
    (left.sequence_order ?? Number.MAX_SAFE_INTEGER) - (right.sequence_order ?? Number.MAX_SAFE_INTEGER)
    || (left.check_in_day ?? Number.MAX_SAFE_INTEGER) - (right.check_in_day ?? Number.MAX_SAFE_INTEGER));
}

function mapActivities(value: unknown): CreatorActivityDetail[] {
  return asRows(value).map((row, index) => {
    const source = sourceFor(row, "activities");
    const snapshot = Object.keys(asRow(row.details)).length > 0;
    return {
      activity_id: nullableString(row.activity_id),
      sequence_order: nullableNumber(source.sequence_order) ?? nullableNumber(row.sequence_order) ?? index + 1,
      activity_name: nullableString(source.activity_name),
      activity_date: nullableString(source.activity_date ?? row.activity_date),
      city: nullableString(source.city),
      duration_hours: nullableNumber(source.duration_hours),
      price_aud: nullableNumber(source.price_aud),
      description: nullableString(source.description),
      booking_required: nullableBoolean(source.booking_required),
      day_number: nullableNumber(source.day_number) ?? nullableNumber(row.day_number),
      start_time: nullableString(source.start_time),
      category: nullableString(source.category),
      address: nullableString(source.address),
      notes: nullableString(snapshot ? source.notes : row.notes),
      media_ids: snapshot ? stringArray(source.media_ids) : [],
      source_id: nullableString(source.source_id),
    };
  });
}

function mapDays(value: unknown): CreatorPackageDay[] {
  return asRows(value)
    .map((row) => ({
      id: nullableString(row.id),
      day_number: nullableNumber(row.day_number),
      title: nullableString(row.title),
      summary: nullableString(row.summary),
      meta: nullableString(row.meta),
      media_ids: stringArray(row.media_ids),
    }))
    .sort((left, right) => (left.day_number ?? 0) - (right.day_number ?? 0));
}

function mapMedia(value: unknown): Array<CreatorMediaDetail & { is_cover: boolean; sort_order: number }> {
  return asRows(value)
    .map((row) => ({
      media_id: stringValue(row.media_id),
      url: stringValue(row.url),
      caption: nullableString(row.caption),
      is_cover: row.is_cover === true,
      sort_order: numberValue(row.sort_order),
    }))
    .sort((left, right) => Number(right.is_cover) - Number(left.is_cover) || left.sort_order - right.sort_order);
}

function mapCreator(value: unknown): AdminPackageCreator | null {
  const row = asRow(value);
  const fullName = nullableString(row.full_name);
  if (!fullName) return null;
  return {
    full_name: fullName,
    avatar_url: nullableString(row.avatar_url),
    influencer_profiles: asRows(row.influencer_profiles).map((profile) => ({
      bio: nullableString(profile.bio),
      instagram_handle: nullableString(profile.instagram_handle),
      tiktok_handle: nullableString(profile.tiktok_handle),
      follower_count: nullableNumber(profile.follower_count),
      verified: profile.verified === true,
    })),
  };
}

export function mapAdminPackageRow(value: unknown): AdminPackageDetail {
  const row = asRow(value);
  const media = mapMedia(row.package_media);
  const flights = mapFlights(row.package_flights);
  const hotels = mapHotels(row.package_hotels);
  const activities = mapActivities(row.package_activities);
  const flightsTotal = flights.reduce((sum, item) => sum + (item.price_aud ?? 0), 0);
  const hotelsTotal = hotels.reduce(
    (sum, item) => sum + (item.price_per_night_aud ?? 0) * item.nights,
    0,
  );
  const activitiesTotal = activities.reduce((sum, item) => sum + (item.price_aud ?? 0), 0);
  const basePrice = nullableNumber(row.base_price_aud);

  return {
    package_id: stringValue(row.package_id),
    title: stringValue(row.title),
    destination_country: nullableString(row.destination_country),
    destination_city: nullableString(row.destination_city),
    duration_days: numberValue(row.duration_days, 1),
    base_price_aud: basePrice,
    status: stringValue(row.status),
    creator_id: stringValue(row.creator_id),
    created_at: stringValue(row.created_at),
    submitted_at: nullableString(row.submitted_at),
    published_at: nullableString(row.published_at),
    cover_image_url: media[0]?.url || null,
    vibes: stringArray(row.vibes),
    description: nullableString(row.description),
    max_group_size: nullableNumber(row.max_group_size),
    season: nullableString(row.season),
    suitable_for: nullableString(row.suitable_for),
    tags: stringArray(row.tags),
    flights,
    hotels,
    activities,
    days: mapDays(row.package_days),
    media,
    creator: mapCreator(row.creator),
    latest_approval: null,
    pricing: {
      flights_total: flightsTotal,
      hotels_total: hotelsTotal,
      activities_total: activitiesTotal,
      components_total: flightsTotal + hotelsTotal + activitiesTotal,
      base_price_aud: basePrice,
    },
  };
}

export async function fetchAdminPackageFromSupabase(
  client: SupabaseClient,
  packageId: string,
): Promise<AdminPackageDetail | null> {
  // ponytail: direct RLS-protected read is a narrow fallback until the existing
  // package-detail endpoint stops applying its creator-only filter to admins.
  const { data, error } = await client
    .from("travel_packages")
    .select(ADMIN_DETAIL_SELECT)
    .eq("package_id", packageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapAdminPackageRow(data) : null;
}

export async function loadAdminPackageForReview(
  fetcher: typeof fetch,
  client: SupabaseClient,
  apiUrl: string,
  token: string,
  packageId: string,
): Promise<AdminPackageDetail> {
  try {
    return await fetchAdminPackage(fetcher, apiUrl, token, packageId);
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.status !== 404) throw error;
    const detail = await fetchAdminPackageFromSupabase(client, packageId);
    if (detail) return detail;
    throw error;
  }
}
