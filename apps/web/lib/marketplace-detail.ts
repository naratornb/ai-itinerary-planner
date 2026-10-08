type MediaLike = { url?: string; media_url?: string; sort_order?: number };

export function formatTripLength(durationDays: number | null | undefined): string | null {
  if (durationDays === null || durationDays === undefined) return null;
  const nights = Math.max(durationDays - 1, 0);
  return `${durationDays} Day${durationDays === 1 ? "" : "s"} / ${nights} Night${nights === 1 ? "" : "s"}`;
}

type PhotoLike = { src: string };
export type PlannedDay = { photos?: PhotoLike[]; items?: { photos?: PhotoLike[] }[] };

/**
 * Which photo goes where on the day-by-day list. Every photo is shown at most
 * once, so the same picture is never repeated across days and stops (or across
 * the per-night rows of one hotel stay), and a slot with no photo gets none —
 * never a stand-in.
 *
 * - Photos linked to days and stops (media_ids) are used as the creator placed
 *   them: a day's first photo is its header, a stop's photos its mosaic.
 * - With no links at all, the uploads other than the cover (the hero already
 *   shows it) become day headers in order, one each, until they run out.
 */
export function planItineraryPhotos(
  days: PlannedDay[],
  media: MediaLike[] | undefined,
  coverUrl: string | null | undefined,
): { dayImages: (string | null)[]; stopImages: string[][][] } {
  const seen = new Set<string>();
  const unseen = (src: string) => {
    if (!src || seen.has(src)) return false;
    seen.add(src);
    return true;
  };
  const linked = days.some((day) =>
    (day.photos?.length ?? 0) > 0 || (day.items ?? []).some((item) => (item.photos?.length ?? 0) > 0));

  if (linked) {
    const dayImages = days.map((day) => (day.photos ?? []).map((photo) => photo.src).find(unseen) ?? null);
    const stopImages = days.map((day) =>
      (day.items ?? []).map((item) => (item.photos ?? []).map((photo) => photo.src).filter(unseen).slice(0, 6)));
    return { dayImages, stopImages };
  }

  const pool = [...new Set(
    [...(media ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((item) => item.media_url || item.url)
      .filter((url): url is string => Boolean(url) && url !== coverUrl),
  )];
  return {
    dayImages: days.map((_, index) => pool[index] ?? null),
    stopImages: days.map((day) => (day.items ?? []).map(() => [])),
  };
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
