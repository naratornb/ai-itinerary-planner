type MediaLike = { url?: string; media_url?: string; sort_order?: number };

export function formatTripLength(durationDays: number | null | undefined): string | null {
  if (durationDays === null || durationDays === undefined) return null;
  const nights = Math.max(durationDays - 1, 0);
  return `${durationDays} Day${durationDays === 1 ? "" : "s"} / ${nights} Night${nights === 1 ? "" : "s"}`;
}

// Index-maps one media item per slot (a day, or a day's stop list) — the
// caller decides what a "slot" is, this just needs how many there are.
export function assignDayImages(
  slotCount: number,
  media: MediaLike[] | undefined,
  fallback: string,
): string[] {
  const sortedMedia = [...(media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return Array.from({ length: slotCount }, (_, index) => sortedMedia[index]?.media_url || sortedMedia[index]?.url || fallback);
}

// Distributes a shared media pool across a day's stops: the first stop takes
// up to 6 photos (so a richly-photographed stop can show a real mosaic),
// everything after gets one each from what's left, falling back when the
// pool runs out — never fabricating a photo that doesn't exist.
export function buildStopImages(
  itemCount: number,
  media: MediaLike[] | undefined,
  fallback: string,
): string[][] {
  const sorted = [...(media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const urlAt = (index: number) => sorted[index]?.media_url || sorted[index]?.url;
  const result: string[][] = [];
  let cursor = 0;
  for (let i = 0; i < itemCount; i += 1) {
    if (i === 0) {
      const firstBatch = sorted.slice(0, 6).map((_, j) => urlAt(j)).filter((url): url is string => Boolean(url));
      result.push(firstBatch.length > 0 ? firstBatch : [fallback]);
      cursor = firstBatch.length;
    } else {
      const url = urlAt(cursor);
      result.push([url ?? fallback]);
      cursor += 1;
    }
  }
  return result;
}

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || "?";
}
