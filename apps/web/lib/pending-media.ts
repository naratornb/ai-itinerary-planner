/**
 * Day photos upload to package_media immediately, but the day association
 * (package_days.media_ids) is only persisted by Save Draft. Between upload
 * and save this stash is the only record of which day a photo belongs to —
 * without it, a refresh dumps every unsaved upload onto day 1.
 *
 * Read/write through window.localStorage in the client component (parsing
 * stays pure, storage stays at the edge). Device-scoped, so a new tab or
 * restarted browser still places photos; stale entries are pruned on load
 * and are inert once a save associates the media_id anyway.
 */

export type PendingMediaDays = Record<string, number>; // media_id -> day_number

export function pendingMediaStorageKey(packageId: string): string {
  return `package-pending-day-media:${packageId}`;
}

export function parsePendingMediaDays(value: string | null): PendingMediaDays {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 1),
    );
  } catch {
    return {};
  }
}
