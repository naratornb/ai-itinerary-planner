import type { AdminApprovalPackage, AdminUser, ApprovalListResponse } from "./admin-api";
import type { CreatorMediaDetail } from "./creator-api";
import type { BuilderDay } from "./itinerary-builder";

const NOT_AVAILABLE = "Not available";
const NOT_PROVIDED = "Not provided";

export function creatorLabel(creatorId: string, users: AdminUser[]): string {
  const user = users.find((candidate) => candidate.id === creatorId);
  const username = user?.username.trim();
  if (username) return username;

  const emailLocalPart = user?.email.split("@", 1)[0]?.trim();
  if (emailLocalPart) return emailLocalPart;

  return `Creator ${creatorId.slice(0, 8) || "unknown"}`;
}

export function formatWaitingAge(
  submittedAt: string | null,
  now: Date | string = new Date(),
): string {
  if (!submittedAt) return NOT_AVAILABLE;
  const submittedTime = new Date(submittedAt).getTime();
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const elapsed = nowTime - submittedTime;
  if (!Number.isFinite(submittedTime) || !Number.isFinite(nowTime) || elapsed < 0) {
    return NOT_AVAILABLE;
  }

  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;

  const days = Math.floor(elapsed / 86_400_000);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function formatSubmittedAt(submittedAt: string | null): string {
  if (!submittedAt) return NOT_AVAILABLE;
  const date = new Date(submittedAt);
  if (!Number.isFinite(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(date);
}

export function formatAdminDestination(
  pkg: Pick<AdminApprovalPackage, "destination_city" | "destination_country">,
): string {
  const parts = [pkg.destination_city, pkg.destination_country]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : NOT_PROVIDED;
}

export function formatAdminDuration(durationDays: number | null): string {
  if (!Number.isInteger(durationDays) || durationDays === null || durationDays < 1) {
    return NOT_PROVIDED;
  }
  return `${durationDays} ${durationDays === 1 ? "day" : "days"}`;
}

export function formatAdminPrice(priceAud: number | null): string {
  if (priceAud === null || !Number.isFinite(priceAud) || priceAud < 0) return NOT_PROVIDED;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(priceAud);
}

export function approvalResultRange(
  meta: ApprovalListResponse["meta"],
  visibleCount: number,
): string {
  if (meta.total < 1 || visibleCount < 1) return `Showing 0 of ${Math.max(0, meta.total)}`;
  const first = (meta.page - 1) * meta.per_page + 1;
  const last = Math.min(meta.total, first + visibleCount - 1);
  return `Showing ${first}–${last} of ${meta.total}`;
}

export function requestSequenceIsCurrent(sequence: number, activeSequence: number): boolean {
  return sequence === activeSequence;
}

export async function optionalAdminUsers(request: Promise<AdminUser[]>): Promise<AdminUser[]> {
  return request.catch(() => []);
}

/** http(s) image addresses only; anything else (javascript:, data:, junk) renders as "invalid". */
export function safeImageSrc(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export type ReviewPhoto = {
  mediaId: string;
  src: string;
  caption: string;
  isCover: boolean;
  /** Where the creator placed it, e.g. "Day 2" or "Day 2 · Hilton New York". Empty = not placed. */
  placements: string[];
};

/**
 * Every uploaded image of a package with the days and stops that use it, so a
 * reviewer sees all of it — including photos that never made it onto a day.
 * The cover is the package's cover URL, falling back to the first upload.
 */
export function reviewPhotos(
  pkg: { media?: CreatorMediaDetail[] | null; cover_image_url?: string | null },
  days: BuilderDay[],
): ReviewPhoto[] {
  const media = pkg.media ?? [];
  const placements = new Map<string, string[]>();
  const place = (mediaId: string | undefined, label: string) => {
    if (!mediaId) return;
    const labels = placements.get(mediaId) ?? [];
    if (!labels.includes(label)) labels.push(label);
    placements.set(mediaId, labels);
  };
  for (const day of days) {
    for (const photo of day.photos ?? []) place(photo.media_id, `Day ${day.day}`);
    for (const item of day.items) {
      for (const photo of item.photos ?? []) place(photo.media_id, `Day ${day.day} · ${item.title}`);
    }
  }
  const coverIndex = pkg.cover_image_url
    ? Math.max(0, media.findIndex((item) => item.url === pkg.cover_image_url))
    : 0;
  return media.map((item, index) => ({
    mediaId: item.media_id,
    src: item.url,
    caption: item.caption?.trim() ?? "",
    isCover: index === coverIndex,
    placements: placements.get(item.media_id) ?? [],
  }));
}
