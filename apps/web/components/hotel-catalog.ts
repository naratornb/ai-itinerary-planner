export function formatHotelStarRating(starRating: number) {
  // repeat() throws on negatives — clamp bad catalog data instead of crashing.
  const stars = Math.min(5, Math.max(0, Math.floor(starRating)));
  return `${"★".repeat(stars)}${"☆".repeat(5 - stars)} ${starRating}-star hotel`;
}
