import { formatHotelStarRating } from "./hotel-catalog";
import Icon from "./icon";

// Shared hotel radio-card — the editor's "Add hotel" grid and the marketplace
// booking card's stay picker render the same row of facts.
export function HotelChoiceCard({ hotel, selected, onSelect, autoFocus }: {
  hotel: {
    hotel_id?: string | null;
    hotel_name: string | null;
    star_rating: number | null;
    city: string | null;
    room_type: string | null;
    price_per_night_aud: number | null;
    image_url?: string | null;
  };
  selected: boolean;
  onSelect: () => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      autoFocus={autoFocus}
      className={`hotel-choice-card${selected ? " selected" : ""}`}
      onClick={onSelect}
    >
      {hotel.image_url ? (
        <img className="hotel-choice-photo" src={hotel.image_url} alt="" />
      ) : (
        <span className="hotel-choice-photo" aria-hidden="true"><Icon name="hotel" size={28} /></span>
      )}
      <span className="hotel-choice-copy">
        <strong>{hotel.hotel_name ?? "Hotel"}</strong>
        {hotel.star_rating != null && <span className="hotel-star-rating">{formatHotelStarRating(hotel.star_rating)}</span>}
        <small>{hotel.city ?? "Not provided"}</small>
        {hotel.room_type && <span>{hotel.room_type}</span>}
        <b>{hotel.price_per_night_aud != null ? `$${hotel.price_per_night_aud.toLocaleString("en-US")}/night` : "Price not provided"}</b>
        {/* Placeholder for a future hotel detail view — inert: the click is
            swallowed so it can't fall through to the card's select handler. */}
        <span className="hotel-choice-detail" onClick={(e) => e.stopPropagation()}>View details</span>
      </span>
      <span className="hotel-choice-check" aria-hidden="true">{selected ? <Icon name="check" size={20} /> : ""}</span>
    </button>
  );
}
