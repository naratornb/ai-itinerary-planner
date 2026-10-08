"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";

import { fetchMarketplacePackage, type MarketplacePackageDetail } from "../lib/marketplace-api";
import { formatHotelStarRating } from "./hotel-catalog";
import Icon from "./icon";
import { supabase } from "../lib/supabase/client";
import { bookingOptionId, canRequestBooking, dateAfter, dedupeCatalogHotels, defaultTravelers, estimateBookingTotal, estimateHotelStayTotal, flightsOn, iataPattern, pickFlightLegs, visibleCatalogHotels, type CatalogHotel, type CatalogOptions } from "../lib/booking-options";
import {
  CheckIcon, color, DepartureDatePicker, detailPrice, displayFont, eyebrowStyle,
  fieldStyle, formatDateLabel, radius, SectionTitle,
} from "./marketplace-detail-screen";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Flight choice rows — same shape the booking card's option rows used, plus
// the numeric price so the estimate can diff against the curated defaults.
type FlightOption = {
  id: string;
  title: string;
  meta: string | null;
  price: number;
  priceLabel: string | null;
};

// Radiogroup of flight rows: arrow keys move focus AND selection (native
// radio-group behaviour), with roving tabindex so the list is one Tab stop.
export function BookingOptionGroup({ label, options, value, onChange, onViewDetails }: {
  label: string;
  options: FlightOption[];
  value: string;
  onChange: (id: string) => void;
  onViewDetails?: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const move = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    listRef.current?.querySelectorAll<HTMLElement>("[role=radio]")[index]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).getAttribute("role") !== "radio") return;
    const idx = options.findIndex((o) => o.id === value);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); move(Math.min(idx + 1, options.length - 1)); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); move(Math.max(idx - 1, 0)); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(options.length - 1); }
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{
        marginTop: 8, padding: 4, maxHeight: 420, overflowY: "auto",
        border: `1px solid ${color.border}`, borderRadius: radius.md, background: color.surface,
      }}
    >
      {options.map((o) => (
        <div className="booking-option-row" key={o.id}>
          <button
            type="button"
            role="radio"
            aria-checked={o.id === value}
            tabIndex={o.id === value ? 0 : -1}
            className="booking-option"
            onClick={() => onChange(o.id)}
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%",
              padding: "12px 14px", border: 0, borderRadius: radius.sm,
              background: "none", fontSize: 14, fontWeight: 600,
              color: color.textPrimary, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</span>
              {o.meta && (
                <span style={{ display: "block", marginTop: 2, fontSize: 12, fontWeight: 400, color: color.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.meta}</span>
              )}
            </span>
            {o.priceLabel && <span style={{ flexShrink: 0, fontSize: 13 }}>{o.priceLabel}</span>}
            {o.id === value && <span className="booking-option-check" aria-hidden="true"><Icon name="check" size={16} /></span>}
          </button>
          {onViewDetails && (
            <button type="button" className="booking-option-detail" onClick={() => onViewDetails(o.id)}>
              View details
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function HotelDetailDrawer({
  hotel,
  checkIn,
  checkOut,
  nights,
  selected,
  providerUrl,
  onClose,
  onSelect,
}: {
  hotel: CatalogHotel;
  checkIn: string;
  checkOut: string;
  nights: number;
  selected: boolean;
  providerUrl?: string | null;
  onClose: () => void;
  onSelect: () => void;
}) {
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.activeElement as HTMLElement,
  );
  const amenities = (hotel.amenities ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const stayTotal = estimateHotelStayTotal(hotel.price_per_night_aud, nights);
  const location = hotel.address || [hotel.city, hotel.country].filter(Boolean).join(", ");

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Overlay className="hotel-detail-backdrop" />
      <Dialog.Content
        className="hotel-detail-drawer"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <div className="hotel-detail-header">
          <div>
            <Dialog.Title>{hotel.hotel_name ?? "Hotel details"}</Dialog.Title>
            {hotel.star_rating != null && <p>{formatHotelStarRating(hotel.star_rating)}</p>}
          </div>
          <Dialog.Close asChild><button type="button" className="hotel-detail-close">Close</button></Dialog.Close>
        </div>

        <div className="hotel-detail-photo-placeholder" role="img" aria-label="No property image available">
          <Icon name="hotel" size={34} />
          <span>No property image available</span>
        </div>

        <dl className="hotel-detail-facts">
          <div><dt>Address</dt><dd>{location || "Not provided"}</dd></div>
          <div><dt>Room</dt><dd>{hotel.room_type || "Not provided"}</dd></div>
          <div><dt>Stay</dt><dd>{checkIn} – {checkOut}<small>{nights} {nights === 1 ? "night" : "nights"}</small></dd></div>
          <div><dt>Nightly price</dt><dd>{hotel.price_per_night_aud == null ? "Not provided" : `${detailPrice(hotel.price_per_night_aud)}/night`}</dd></div>
          <div><dt>Estimated stay total</dt><dd>{stayTotal == null ? "Not provided" : detailPrice(stayTotal)}</dd></div>
        </dl>

        <section className="hotel-detail-amenities" aria-labelledby="hotel-amenities-title">
          <h3 id="hotel-amenities-title">Amenities</h3>
          {amenities.length ? <ul>{amenities.map((amenity) => <li key={amenity}>{amenity}</li>)}</ul> : <p>Not provided</p>}
        </section>

        <div className="hotel-detail-actions">
          <button type="button" className="booking-primary-action" disabled={selected} onClick={onSelect}>
            {selected ? "Selected stay" : "Select this stay"}
          </button>
          {providerUrl ? (
            <a className="hotel-provider-action" href={providerUrl} target="_blank" rel="noreferrer">View on provider site</a>
          ) : (
            <button type="button" className="hotel-provider-action" disabled title="Provider link not available yet">View on provider site</button>
          )}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function BookingSelectionSummary({
  title,
  actionLabel,
  open,
  onToggle,
  rows,
  children,
}: {
  title: string;
  actionLabel: string;
  open: boolean;
  onToggle: () => void;
  rows: Array<{ label: string; title: string; meta?: string | null; price?: string | null }>;
  children: ReactNode;
}) {
  return (
    <section className="booking-summary-section">
      <div className="booking-section-heading">
        <SectionTitle>{title}</SectionTitle>
        <button type="button" className="booking-change-action" aria-expanded={open} onClick={onToggle}>
          {open ? "Done" : actionLabel}
        </button>
      </div>
      <div className="booking-selection-summary">
        {rows.map((row) => <div className="booking-selection-row" key={`${row.label}-${row.title}`}>
          <span>{row.label}</span>
          <strong>{row.title}</strong>
          {row.meta && <small>{row.meta}</small>}
          {row.price && <b>{row.price}</b>}
        </div>)}
        {open && <div className="booking-selection-editor">{children}</div>}
      </div>
    </section>
  );
}

export function BookingRequestConfirmation({
  title,
  destination,
  departure,
  returnDate,
  travelers,
  outbound,
  returnFlight,
  hotel,
  total,
  onBack,
}: {
  title: string;
  destination: string;
  departure: string;
  returnDate: string;
  travelers: number;
  outbound: string;
  returnFlight?: string;
  hotel?: string;
  total: string;
  onBack: () => void;
}) {
  return (
    <section className="booking-complete" aria-labelledby="booking-complete-title">
      <span className="booking-complete-icon" aria-hidden="true"><CheckIcon /></span>
      <h1 id="booking-complete-title">Booking request complete</h1>
      <p className="booking-complete-lead">Your trip summary is ready. Review the details below.</p>

      <div className="booking-complete-summary">
        <div><span>Trip</span><strong>{title}</strong>{destination && <small>{destination}</small>}</div>
        <div><span>Dates</span><strong>{departure} – {returnDate}</strong><small>{travelers} {travelers === 1 ? "traveler" : "travelers"}</small></div>
        <div><span>Outbound flight</span><strong>{outbound}</strong>{returnFlight && <small>Return: {returnFlight}</small>}</div>
        {hotel && <div><span>Stay</span><strong>{hotel}</strong></div>}
        <div className="booking-complete-total"><span>Estimated total</span><strong>{total}</strong></div>
      </div>

      <button type="button" className="booking-primary-action" onClick={onBack}>Back to trip</button>
    </section>
  );
}

function BookingDetail({ pkg }: { pkg: MarketplacePackageDetail }) {
  const router = useRouter();

  const { outbound: outboundFlight, returnLeg: returnFlight } = pickFlightLegs(pkg.flights);
  const primaryHotel = pkg.hotels?.[0] ?? null;
  const hotelNights = primaryHotel?.check_in_day != null && primaryHotel?.check_out_day != null
    ? primaryHotel.check_out_day - primaryHotel.check_in_day
    : null;

  const outboundChoiceId = outboundFlight
    ? bookingOptionId(outboundFlight.flight_id, outboundFlight.package_component_id, `package-outbound-${pkg.package_id}`)
    : "";
  const returnChoiceId = returnFlight
    ? bookingOptionId(returnFlight.flight_id, returnFlight.package_component_id, `package-return-${pkg.package_id}`)
    : "";
  const primaryHotelChoiceId = primaryHotel
    ? bookingOptionId(primaryHotel.hotel_id, primaryHotel.package_component_id, `package-hotel-${pkg.package_id}`)
    : "";

  const [departure, setDeparture] = useState(outboundFlight?.departure_datetime?.slice(0, 10) ?? "");
  const [travelers, setTravelers] = useState(() => defaultTravelers(pkg.max_group_size));
  const [outboundSel, setOutboundSel] = useState(outboundChoiceId);
  const [returnSel, setReturnSel] = useState(returnChoiceId);
  const [hotelSel, setHotelSel] = useState(primaryHotelChoiceId);
  const [catalog, setCatalog] = useState<CatalogOptions | null>(null);
  const [editingFlights, setEditingFlights] = useState(false);
  const [editingStay, setEditingStay] = useState(false);
  const [showAllHotels, setShowAllHotels] = useState(false);
  const [detailHotelId, setDetailHotelId] = useState<string | null>(null);
  const [requestComplete, setRequestComplete] = useState(false);
  const maxTravelers = Math.max(1, pkg.max_group_size ?? 8);

  // The real choices: other dated departures on the package's flight routes
  // and other hotels in the destination city. Catalog tables are public-read
  // (RLS) so the anon client can query them directly.
  useEffect(() => {
    let active = true;
    const flightCols = "flight_id,airline,departure_datetime,cabin_class,price_aud";
    const today = new Date().toISOString();
    void Promise.all([
      outboundFlight?.origin_iata && outboundFlight?.destination_iata
        ? supabase.from("flights").select(flightCols).ilike("origin", iataPattern(outboundFlight.origin_iata)).ilike("destination", iataPattern(outboundFlight.destination_iata)).gte("departure_datetime", today).order("departure_datetime").limit(200)
        : Promise.resolve({ data: null }),
      returnFlight?.origin_iata && returnFlight?.destination_iata
        ? supabase.from("flights").select(flightCols).ilike("origin", iataPattern(returnFlight.origin_iata)).ilike("destination", iataPattern(returnFlight.destination_iata)).gte("departure_datetime", today).order("departure_datetime").limit(200)
        : Promise.resolve({ data: null }),
      pkg.destination_city
        ? supabase.from("hotels").select("hotel_id,hotel_name,star_rating,room_type,city,country,address,amenities,price_per_night_aud").eq("city", pkg.destination_city).order("price_per_night_aud")
        : Promise.resolve({ data: null }),
    ]).then(([outRes, retRes, hotelRes]) => {
      if (!active) return;
      setCatalog({
        outbound: outRes.data ?? [],
        returnLeg: retRes.data ?? [],
        hotels: hotelRes.data ?? [],
      });
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.package_id]);

  const outDep = outboundFlight?.departure_datetime?.slice(0, 10) ?? null;
  const retDep = returnFlight?.departure_datetime?.slice(0, 10) ?? null;
  const returnDayOffset = outDep && retDep
    ? Math.round((Date.parse(`${retDep}T12:00:00Z`) - Date.parse(`${outDep}T12:00:00Z`)) / 86400000)
    : (returnFlight?.day_number ?? pkg.duration_days ?? 1) - 1;
  const returnDate = dateAfter(departure, returnDayOffset);

  const flightOption = (f: { airline?: string | null; flight_number?: string | null; flight_id?: string | null; package_component_id?: string | null; cabin_class?: string | null; departure_datetime?: string | null; price_aud?: number | null }, fallback: string): FlightOption => ({
    id: bookingOptionId(f.flight_id, f.package_component_id, fallback),
    title: [f.airline, f.flight_number ?? f.flight_id?.split("-")[0]].filter(Boolean).join(" "),
    meta: f.cabin_class ? f.cabin_class.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null,
    price: f.price_aud ?? 0,
    priceLabel: f.price_aud != null ? detailPrice(f.price_aud) : null,
  });

  const outboundOnDate = flightsOn(catalog?.outbound, departure);
  const outAll = outboundOnDate.length ? outboundOnDate : outboundFlight ? [outboundFlight] : [];
  const outboundOptions = outAll.map((f, index) => {
    const o = flightOption(f, f === outboundFlight ? outboundChoiceId : `outbound-${pkg.package_id}-${index}`);
    const d = f.departure_datetime?.slice(0, 10);
    return { ...o, meta: [d ? formatDateLabel(d) : null, o.meta].filter(Boolean).join(" · ") };
  });
  const retOnDate = flightsOn(catalog?.returnLeg, returnDate);
  const returnOptions = retOnDate.length
    ? retOnDate.map((flight, index) => flightOption(flight, `return-${pkg.package_id}-${index}`))
    : returnFlight ? [flightOption(returnFlight, returnChoiceId)] : [];
  const primaryCatalogHotel = (catalog?.hotels ?? []).find((hotel) => hotel.hotel_id === primaryHotel?.hotel_id);
  const primaryHotelOption: CatalogHotel | null = primaryHotel ? {
    hotel_id: primaryHotelChoiceId,
    hotel_name: primaryHotel.hotel_name,
    star_rating: primaryHotel.star_rating,
    room_type: primaryHotel.room_type,
    city: primaryHotel.city,
    country: primaryCatalogHotel?.country ?? pkg.destination_country,
    address: primaryHotel.address ?? primaryCatalogHotel?.address ?? null,
    amenities: primaryCatalogHotel?.amenities ?? null,
    price_per_night_aud: primaryHotel.price_per_night_aud,
  } : null;
  const hotelOptions = dedupeCatalogHotels([
    ...(primaryHotelOption ? [primaryHotelOption] : []),
    ...(catalog?.hotels ?? []).filter((h) => h.hotel_id !== primaryHotel?.hotel_id),
  ]);
  const departureDates = [...new Set([departure, ...(catalog?.outbound ?? []).map((f) => f.departure_datetime.slice(0, 10))].filter(Boolean))].sort();

  const changeDeparture = (date: string, keepOutbound = outboundSel) => {
    setDeparture(date);
    const outs = flightsOn(catalog?.outbound, date);
    if (outs.length && !outs.some((f) => f.flight_id === keepOutbound)) setOutboundSel(outs[0].flight_id);
    const rets = flightsOn(catalog?.returnLeg, dateAfter(date, returnDayOffset));
    if (rets.length && !rets.some((f) => f.flight_id === returnSel)) setReturnSel(rets[0].flight_id);
  };
  const changeOutbound = (id: string) => {
    setOutboundSel(id);
    const d = (catalog?.outbound ?? []).find((f) => f.flight_id === id)?.departure_datetime?.slice(0, 10);
    if (d && d !== departure) changeDeparture(d, id);
  };

  const selOutbound = outboundOptions.find((o) => o.id === outboundSel);
  const selReturn = returnOptions.find((o) => o.id === returnSel);
  const selHotel = hotelOptions.find((o) => o.hotel_id === hotelSel);
  const detailHotel = hotelOptions.find((o) => o.hotel_id === detailHotelId);
  const hotelChoiceOptions: FlightOption[] = visibleCatalogHotels(hotelOptions, showAllHotels, hotelSel).map((hotel) => ({
    id: hotel.hotel_id,
    title: hotel.hotel_name ?? "Hotel",
    meta: [
      hotel.star_rating != null ? formatHotelStarRating(hotel.star_rating) : null,
      hotel.room_type,
    ].filter(Boolean).join(" · ") || null,
    price: hotel.price_per_night_aud ?? 0,
    priceLabel: hotel.price_per_night_aud != null ? `${detailPrice(hotel.price_per_night_aud)}/night` : null,
  }));
  const flightDelta = (selOutbound?.price ?? outboundFlight?.price_aud ?? 0) - (outboundFlight?.price_aud ?? 0)
    + (selReturn?.price ?? returnFlight?.price_aud ?? 0) - (returnFlight?.price_aud ?? 0);
  const estimateTotal = estimateBookingTotal({
    basePrice: pkg.base_price_aud ?? null,
    travelers,
    flightDelta,
    hotelNightlyDelta: (selHotel?.price_per_night_aud ?? primaryHotel?.price_per_night_aud ?? 0) - (primaryHotel?.price_per_night_aud ?? 0),
    nights: hotelNights ?? 1,
  });

  const destination = [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", ");
  const stayCheckIn = dateAfter(departure, Math.max(0, (primaryHotel?.check_in_day ?? 1) - 1));
  const stayCheckOut = dateAfter(departure, Math.max(0, (primaryHotel?.check_out_day ?? ((primaryHotel?.check_in_day ?? 1) + (hotelNights ?? 1))) - 1));
  const requestReady = canRequestBooking({
    departure,
    estimateTotal,
    outboundRequired: Boolean(outboundFlight),
    outboundId: selOutbound?.id ?? "",
    returnRequired: Boolean(returnFlight),
    returnId: selReturn?.id ?? "",
    hotelRequired: Boolean(primaryHotel),
    hotelId: selHotel?.hotel_id ?? "",
  });

  if (requestComplete) {
    return (
      <main className="booking-page">
        <div className="booking-page-shell booking-page-shell-complete">
          <BookingRequestConfirmation
            title={pkg.title}
            destination={destination}
            departure={formatDateLabel(departure)}
            returnDate={returnDate ? formatDateLabel(returnDate) : "—"}
            travelers={travelers}
            outbound={selOutbound?.title ?? "—"}
            returnFlight={selReturn?.title}
            hotel={selHotel?.hotel_name ?? undefined}
            total={estimateTotal == null ? "—" : detailPrice(estimateTotal)}
            onBack={() => router.push(`/marketplace/packages/${pkg.package_id}`)}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="booking-page">
      <div className="booking-page-shell">
        <header className="booking-intro">
          <button
            type="button"
            className="booking-back-action"
            onClick={() => router.push(`/marketplace/packages/${pkg.package_id}`)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to trip
          </button>
          <h1 style={{ fontFamily: displayFont }}>{pkg.title}</h1>
          {destination && <p>{destination}</p>}
        </header>

        <section className="booking-trip-section">
          <SectionTitle>Trip dates</SectionTitle>
          <div className="booking-trip-grid">
            <div>
              <p style={eyebrowStyle}>Departure</p>
              {departureDates.length > 1 ? (
                <DepartureDatePicker label="Departure" dates={departureDates} value={departure} onChange={changeDeparture} />
              ) : (
                <input
                  type="date"
                  value={departure}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => changeDeparture(e.target.value)}
                  style={fieldStyle}
                />
              )}
            </div>
            <div>
              <p style={eyebrowStyle}>Return</p>
              <div aria-label="Return date" style={{ ...fieldStyle, color: returnDate ? color.textPrimary : color.textDisabled }}>
                {returnDate ? formatDateLabel(returnDate) : "—"}
              </div>
              {hotelNights != null && <p style={{ margin: "6px 0 0", fontSize: 12, color: color.textSecondary }}>{hotelNights} nights</p>}
            </div>
            <div>
              <p style={eyebrowStyle}>Travelers</p>
              <select value={travelers} onChange={(e) => setTravelers(Number(e.target.value))} style={fieldStyle}>
                {Array.from({ length: maxTravelers }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: color.textSecondary }}>{pkg.max_group_size ? `Max ${pkg.max_group_size}` : "Per booking"}</p>
            </div>
          </div>
        </section>

        {outboundFlight && outboundOptions.length > 0 && (
          <BookingSelectionSummary
            title="Flights"
            actionLabel="Change flight"
            open={editingFlights}
            onToggle={() => { setEditingFlights((open) => !open); setEditingStay(false); }}
            rows={[
              {
                label: "Outbound",
                title: selOutbound?.title ?? "Choose a flight",
                meta: selOutbound?.meta,
                price: selOutbound?.priceLabel,
              },
              ...(returnFlight ? [{
                label: "Return",
                title: selReturn?.title ?? "Choose a flight",
                meta: [returnDate ? formatDateLabel(returnDate) : null, selReturn?.meta].filter(Boolean).join(" · "),
                price: selReturn?.priceLabel,
              }] : []),
            ]}
          >
            <h3>Choose outbound flight</h3>
            <BookingOptionGroup label="Outbound flight" options={outboundOptions} value={outboundSel} onChange={changeOutbound} />
            {returnFlight && returnOptions.length > 0 && <>
              <h3>Choose return flight</h3>
              <BookingOptionGroup label="Return flight" options={returnOptions} value={returnSel} onChange={setReturnSel} />
            </>}
          </BookingSelectionSummary>
        )}

        {primaryHotel && hotelOptions.length > 0 && (
          <BookingSelectionSummary
            title="Your stay"
            actionLabel="Change stay"
            open={editingStay}
            onToggle={() => { setEditingStay((open) => !open); setEditingFlights(false); }}
            rows={[{
              label: hotelNights ? `${hotelNights} nights` : "Stay",
              title: selHotel?.hotel_name ?? "Choose a hotel",
              meta: [
                selHotel?.star_rating != null ? formatHotelStarRating(selHotel.star_rating) : null,
                selHotel?.room_type,
              ].filter(Boolean).join(" · "),
              price: selHotel?.price_per_night_aud != null ? `${detailPrice(selHotel.price_per_night_aud)}/night` : null,
            }]}
          >
            <h3>Choose your stay</h3>
            <BookingOptionGroup label="Hotel options" options={hotelChoiceOptions} value={hotelSel} onChange={setHotelSel} onViewDetails={setDetailHotelId} />
            {hotelOptions.length > 6 && <button type="button" className="booking-more-action" onClick={() => setShowAllHotels((showAll) => !showAll)}>
              {showAllHotels ? "Show fewer hotels" : `See ${hotelOptions.length - 6} more hotels`}
            </button>}
          </BookingSelectionSummary>
        )}

        <section className="booking-request-card">
          {estimateTotal != null && (
            <p style={{ margin: 0, fontSize: 14, color: color.textSecondary }}>
              Estimated total for {travelers} {travelers === 1 ? "traveler" : "travelers"}:{" "}
              <strong style={{ color: color.textPrimary, fontSize: 20 }}>{detailPrice(estimateTotal)}</strong>
            </p>
          )}
          <button
            type="button"
            disabled={!requestReady}
            aria-disabled={!requestReady}
            className="booking-primary-action"
            onClick={() => setRequestComplete(true)}
          >
            Request booking
          </button>
          <p style={{ margin: "8px 0 0", fontSize: 11, textAlign: "center", color: color.textDisabled }}>
            {requestReady ? "Review your selections before requesting" : "Complete the trip summary to continue"}
          </p>
          {pkg.status === "live" && (
            <p style={{ margin: "16px 0 0", fontSize: 12, color: color.textSecondary, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: color.action, display: "inline-flex" }}><CheckIcon /></span>
              Reviewed &amp; approved by our travel team
            </p>
          )}
        </section>
      </div>
      {detailHotel && (
        <HotelDetailDrawer
          hotel={detailHotel}
          checkIn={stayCheckIn ? formatDateLabel(stayCheckIn) : "Not provided"}
          checkOut={stayCheckOut ? formatDateLabel(stayCheckOut) : "Not provided"}
          nights={hotelNights ?? 1}
          selected={detailHotel.hotel_id === hotelSel}
          providerUrl={null}
          onClose={() => setDetailHotelId(null)}
          onSelect={() => {
            setHotelSel(detailHotel.hotel_id);
            setDetailHotelId(null);
          }}
        />
      )}
    </main>
  );
}

export function MarketplaceBookingScreen({ packageId }: { packageId: string }) {
  const [pkg, setPackage] = useState<MarketplacePackageDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadPackage = async () => {
    setLoading(true);
    setError("");
    try {
      setPackage(await fetchMarketplacePackage(fetch, API_URL, packageId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load this package.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void fetchMarketplacePackage(fetch, API_URL, packageId)
      .then((data) => {
        if (active) setPackage(data);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load this package.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [packageId]);

  if (loading) return <p role="status" style={{ padding: 64, textAlign: "center" }}>Loading trip…</p>;
  if (error) return (
    <main style={{ padding: 64, textAlign: "center" }}>
      <p role="alert" style={{ color: color.error }}>{error}</p>
      <button type="button" onClick={() => void loadPackage()} style={{ padding: "12px 20px", border: `1px solid ${color.border}`, borderRadius: radius.md, background: color.surface, cursor: "pointer" }}>Try again</button>
    </main>
  );
  if (!pkg) return null;

  return <BookingDetail pkg={pkg} />;
}
