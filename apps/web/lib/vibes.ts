/**
 * The six vibes offered at itinerary generation — the single source for ids
 * and display labels. The wizard stores the picked ids in
 * `travel_packages.tags` (no dedicated column exists), so every reader
 * normalizes stored tags through `vibeLabelsFromTags` rather than rendering
 * raw tag strings.
 */
export const VIBES = [
  { id: "chill",      label: "Chill",            desc: "Spa days, yoga sessions, and slow-paced downtime",          img: "https://images.unsplash.com/photo-1602002418816-5c0aeef426aa?w=600&h=320&fit=crop" },
  { id: "adventure",  label: "Adventure",        desc: "Active experiences and outdoor activities",                 img: "https://images.unsplash.com/photo-1533240332313-0db49b459ad6?w=600&h=320&fit=crop" },
  { id: "luxury",     label: "Luxury",           desc: "Premium stays and high-end, curated experiences",           img: "https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=600&h=320&fit=crop" },
  { id: "local",      label: "Local Experience", desc: "Walking tours, museums, and hands-on culture classes",      img: "https://images.unsplash.com/photo-1747396108528-682b02327818?w=600&h=320&fit=crop" },
  { id: "foodie",     label: "Foodie",           desc: "Street food tours, cooking classes, and night markets",     img: "https://images.unsplash.com/photo-1777576506689-d28f3b4cb33a?w=600&h=320&fit=crop" },
  { id: "scenic",     label: "Scenic",           desc: "Countryside day trips, river cruises, and scenic viewpoints", img: "https://images.unsplash.com/photo-1626948688703-0136bc0a90da?w=600&h=320&fit=crop" },
] as const;

export type VibeId = (typeof VIBES)[number]["id"];

/**
 * Stored tag -> vibe id. Ids map to themselves; "food" and "culture" are the
 * engine's theme keywords for foodie/local (VIBE_TO_KEYWORD in
 * lib/ai/itinerary.ts) — older packages carry those in tags instead of ids.
 */
const TAG_TO_VIBE: Record<string, VibeId> = {
  chill: "chill",
  adventure: "adventure",
  luxury: "luxury",
  local: "local",
  foodie: "foodie",
  scenic: "scenic",
  food: "foodie",
  culture: "local",
};

/** Canonical labels for the vibes a package's tags express, in VIBES order. */
export function vibeLabelsFromTags(tags: readonly string[] | null | undefined): string[] {
  if (!tags?.length) return [];
  const ids = new Set<VibeId>();
  for (const tag of tags) {
    const id = TAG_TO_VIBE[tag.trim().toLowerCase()];
    if (id) ids.add(id);
  }
  return VIBES.filter((v) => ids.has(v.id)).map((v) => v.label);
}
