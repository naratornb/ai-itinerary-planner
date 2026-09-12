export function formatHotelStarRating(starRating: number) {
  return `${"★".repeat(starRating)}${"☆".repeat(5 - starRating)} ${starRating}-star hotel`;
}
