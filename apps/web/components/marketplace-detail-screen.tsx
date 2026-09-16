"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchMarketplacePackage, type MarketplacePackageDetail, type MarketplaceReview } from "../lib/marketplace-api";
import { supabase } from "../lib/supabase/client";
import { assignDayImages, buildStopImages, formatTripLength, initials } from "../lib/marketplace-detail";
import { buildDaysFromPackage, type TimelineItem } from "../lib/itinerary-builder";
import { dateAfter, estimateBookingTotal, flightsOn, iataPattern, type CatalogOptions } from "../lib/booking-options";
import { vibeLabelsFromTags } from "../lib/vibes";
import type { CreatorPackageDetail } from "../lib/creator-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const fallbackImage = "https://images.unsplash.com/photo-1510391532992-e1b94a277a3a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1400";

// Design tokens from apps/web/design/design-tokens.json — keep this page on
// the same system as the rest of the marketplace rather than one-off values.
const color = {
  action: "#0072EA",
  surface: "#FFFFFF",
  surfaceSubtle: "#F5F5F5",
  infoSubtle: "#EEF6FF",
  error: "#D40119",
  textPrimary: "#212121",
  textSecondary: "#616161",
  textDisabled: "#9E9E9E",
  border: "#E0E0E0",
};
const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
const displayFont = "var(--fc-font-display)";

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: color.textSecondary,
};

const fieldStyle: React.CSSProperties = {
  marginTop: 6,
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 28px 9px 10px",
  fontSize: 14,
  fontWeight: 600,
  color: color.textPrimary,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  background: color.surface,
};

function formatDateLabel(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

// ponytail: travel_packages has no season column yet — curated values keyed by
// package id fill the strip until the backend ships the field; the API value
// (pkg.season) wins when it arrives. Delete this map with the column.
const SEASON_BY_PACKAGE: Record<string, string> = {
  "b0000000-0000-0000-0000-000000000001": "Spring & autumn", // Tokyo
  "b0000000-0000-0000-0000-000000000002": "Summer & winter", // Queenstown
  "b0000000-0000-0000-0000-000000000003": "Spring & summer", // Paris
  "b0000000-0000-0000-0000-000000000009": "Year-round", // Singapore
  "b0000000-0000-0000-0000-000000000010": "Spring & autumn", // Osaka
  "b0000000-0000-0000-0000-000000000011": "Year-round", // Kuala Lumpur
};

function detailPrice(price: number | null) {
  if (price === null) return "Price on request";
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD", maximumFractionDigits: 0,
  }).format(price);
}

function iataCode(location: string | null | undefined) {
  if (!location) return null;
  const match = location.match(/\(([^)]+)\)/);
  return match ? match[1] : location;
}

type DetailPackage = MarketplacePackageDetail | CreatorPackageDetail;

function HeroOverlay({ image, alt, children, height, radiusPx = radius.lg, fullBleed = false, overlayTop }: { image: string; alt: string; children: React.ReactNode; height: number; radiusPx?: number; fullBleed?: boolean; overlayTop?: React.ReactNode }) {
  const insetX = fullBleed ? "max(24px, calc((100vw - 1280px) / 2 + 24px))" : "24px";
  return (
    <div style={{
      position: "relative", height, overflow: "hidden", border: `1px solid ${color.border}`,
      ...(fullBleed
        ? { width: "100vw", marginLeft: "calc(50% - 50vw)", marginRight: "calc(50% - 50vw)", borderLeft: 0, borderRight: 0 }
        : { borderRadius: radiusPx }),
    }}>
      <img src={image} alt={alt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 60%)" }} />
      {overlayTop && (
        <div style={{ position: "absolute", top: 24, left: 0, right: 0, padding: `0 ${insetX}`, zIndex: 1 }}>
          {overlayTop}
        </div>
      )}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: `0 ${insetX} 48px`, color: "#FFFFFF" }}>
        {children}
      </div>
    </div>
  );
}

function InstagramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.5 3c.4 2.2 1.9 3.7 4 3.9v3.1c-1.4 0-2.8-.4-4-1.2v6.4a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6 0 .9.1v3.2a2.5 2.5 0 1 0 1.7 2.3V3z" />
    </svg>
  );
}

function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.3" />
    </svg>
  );
}

function PeopleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6" /><path d="M16 4.3a3 3 0 0 1 0 5.8M20 20c0-2.8-2-5.1-4.7-5.8" />
    </svg>
  );
}

function CalendarIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function SnowflakeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7.4-4.7-9.6-9.2A5.6 5.6 0 0 1 12 6.4a5.6 5.6 0 0 1 9.6 5.4C19.4 16.3 12 21 12 21z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4M8 8l4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg width="14" height="9" viewBox="0 0 14 9" fill="none" style={{ flexShrink: 0, transform: up ? "rotate(180deg)" : undefined }}>
      <path d="M1 1L7 7L13 1" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Every content section shares one heading pattern: 24px display-font title.
// Pair with eyebrowStyle for inner labels.
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ margin: 0, fontFamily: displayFont, fontSize: 24, fontWeight: 800, letterSpacing: "-0.01em" }}>
      {children}
    </h2>
  );
}

// Same icon language as the package editor (apps/web/components/itinerary-editor.tsx's
// local `Icon`) so a flight/hotel/activity stop looks identical wherever it shows up.
function StopIcon({ name, size = 20, stroke = color.textPrimary }: { name: TimelineItem["icon"]; size?: number; stroke?: string }) {
  const paths: Record<string, React.ReactNode> = {
    plane: <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />,
    hotel: <><path d="M3 20V7m18 13V11a2 2 0 0 0-2-2h-7v11M3 14h18M7 10h2" /><path d="M3 20h18" /></>,
    star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {paths[name] ?? paths.star}
    </svg>
  );
}

// Up to 6 photos per stop. One photo shows as a single landscape tile; more
// than one shows as a mosaic (one large + up to two small), with a "+N"
// overlay when there are more than fit. Every tile opens the lightbox.
function StopPhotoGrid({ images, onOpen }: { images: string[]; onOpen: (images: string[], index: number) => void }) {
  const shown = images.slice(0, 6);
  if (shown.length === 0) return null;

  const tileButtonStyle: React.CSSProperties = { all: "unset", cursor: "pointer", position: "relative", overflow: "hidden", display: "block" };

  if (shown.length === 1) {
    return (
      <button type="button" onClick={() => onOpen(shown, 0)} style={{ ...tileButtonStyle, width: 320, flexShrink: 0, borderRadius: radius.sm, aspectRatio: "16 / 10" }}>
        <img src={shown[0]} alt="Example photo" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      </button>
    );
  }

  const visible = shown.slice(0, 3);
  const extra = shown.length - visible.length;
  return (
    <div style={{ width: 320, height: 200, flexShrink: 0, display: "grid", gridTemplateColumns: "1.4fr 1fr", gridTemplateRows: "1fr 1fr", gap: 2, borderRadius: radius.sm, overflow: "hidden" }}>
      {visible.map((src, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onOpen(shown, i)}
          style={{ ...tileButtonStyle, gridColumn: i === 0 ? "1" : "2", gridRow: i === 0 ? "1 / 3" : i === 1 ? "1" : "2" }}
        >
          <img src={src} alt="Example photo" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          {i === visible.length - 1 && extra > 0 && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontSize: 18, fontWeight: 700 }}>
              +{extra}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function Lightbox({ images, index, onClose, onNavigate }: { images: string[]; index: number; onClose: () => void; onNavigate: (index: number) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNavigate((index + 1) % images.length);
      if (e.key === "ArrowLeft") onNavigate((index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onClose, onNavigate]);

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <button type="button" onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 24, right: 24, border: "none", background: "none", color: "#FFFFFF", fontSize: 32, cursor: "pointer", lineHeight: 1 }}>×</button>
      {images.length > 1 && (
        <button type="button" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); onNavigate((index - 1 + images.length) % images.length); }} style={{ position: "absolute", left: 24, border: "none", background: "none", color: "#FFFFFF", fontSize: 40, cursor: "pointer" }}>‹</button>
      )}
      <img
        src={images[index]}
        alt="Example photo, enlarged"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "min(90vw, 1100px)", maxHeight: "85vh", objectFit: "contain", borderRadius: radius.md }}
      />
      {images.length > 1 && (
        <button type="button" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); onNavigate((index + 1) % images.length); }} style={{ position: "absolute", right: 24, border: "none", background: "none", color: "#FFFFFF", fontSize: 40, cursor: "pointer" }}>›</button>
      )}
      {images.length > 1 && (
        <p style={{ position: "absolute", bottom: 24, color: "rgba(255,255,255,0.8)", fontSize: 13 }}>{index + 1} / {images.length}</p>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function TipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.2h5.2c0-.9.4-1.7 1-2.2A6 6 0 0 0 12 3z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Prefer whatever real detail the item actually carries; only fall back to a
// generic (non-fabricated) line when the creator never filled one in.
function itemDetailText(item: TimelineItem): string {
  return item.notes || item.roomType || item.address || "Full details for this stop unlock when you purchase this trip.";
}

function CreatorTip({ text, revealed = false }: { text: string; revealed?: boolean }) {
  return (
    <div style={{ padding: "16px 20px", background: revealed ? color.infoSubtle : color.surfaceSubtle, borderRadius: radius.lg }}>
      <p style={{ ...eyebrowStyle, display: "flex", alignItems: "center", gap: 6, color: revealed ? color.action : color.textSecondary }}>
        {revealed ? <TipIcon /> : <LockIcon />} Creator tip
      </p>
      <p
        aria-hidden={!revealed}
        style={{
          margin: "6px 0 0", fontSize: 13, fontStyle: "italic", color: color.textSecondary, lineHeight: 1.5,
          ...(revealed ? {} : { filter: "blur(4px)", userSelect: "none" }),
        }}
      >
        {text}
      </p>
      {!revealed && <p style={{ margin: "8px 0 0", fontSize: 11, color: color.textDisabled }}>Unlocks when you purchase this trip.</p>}
    </div>
  );
}

function DayCard({
  day, index, image, items, stopImages, expanded, onToggle, onOpenPhoto,
}: {
  day: { id?: string | null; day_number?: number | null; title?: string | null; summary?: string | null };
  index: number;
  image: string;
  items: TimelineItem[];
  stopImages: string[][];
  expanded: boolean;
  onToggle: () => void;
  onOpenPhoto: (images: string[], index: number) => void;
}) {
  const label = `Day ${day.day_number ?? index + 1}${day.title ? `: ${day.title}` : ""}`;
  return (
    <div style={{ border: `1px solid ${color.border}`, borderRadius: radius.lg, overflow: "hidden" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ all: "unset", boxSizing: "border-box", display: "block", position: "relative", width: "100%", height: 340, cursor: "pointer" }}
      >
        <img src={image} alt={label} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 60%)" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, padding: 28, color: "#FFFFFF" }}>
          <h3 style={{ margin: 0, fontFamily: displayFont, fontSize: 28, fontWeight: 800, letterSpacing: "-0.01em", textTransform: "uppercase" }}>{label}</h3>
          <Chevron up={expanded} />
        </div>
      </button>
      {expanded && (day.summary || items.length > 0) && (
        <div style={{ background: color.surface, borderTop: `1px solid ${color.border}` }}>
          {day.summary && (
            <p style={{ margin: 0, padding: 24, fontSize: 16, lineHeight: 1.5, color: color.textPrimary, borderBottom: items.length > 0 ? `1px solid ${color.border}` : undefined }}>{day.summary}</p>
          )}
          {items.map((item, itemIndex) => (
            <div key={item.id} style={{ borderBottom: itemIndex < items.length - 1 ? `1px solid ${color.border}` : undefined }}>
              <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 24 }}>
                <StopPhotoGrid images={stopImages[itemIndex] ?? []} onOpen={onOpenPhoto} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ ...eyebrowStyle, display: "flex", alignItems: "center", gap: 6 }}>
                    <StopIcon name={item.icon} size={16} /> {item.time} · {item.type}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color: color.textPrimary }}>{item.title}</p>
                  {item.subtitle && <p style={{ margin: "2px 0 0", fontSize: 13, color: color.textSecondary }}>{item.subtitle}</p>}
                  <div style={{ marginTop: 12 }}>
                    <CreatorTip text={itemDetailText(item)} revealed={itemIndex === 0} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PackageDetailView({
  pkg,
  backLabel,
  onBack,
  previewLabel,
  catalog,
  reviews,
}: {
  pkg: DetailPackage;
  backLabel: string;
  onBack: () => void;
  previewLabel?: string;
  catalog?: CatalogOptions | null;
  reviews?: MarketplaceReview[] | null;
}) {
  const [shareStatus, setShareStatus] = useState("");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  const toggleDay = (key: string) => {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const media = pkg.media ?? [];
  const coverImage = "cover_image_url" in pkg ? pkg.cover_image_url : null;
  const coverMedia = media.find((item) => "is_cover" in item && item.is_cover);
  const firstMedia = media[0];
  const cover = coverImage
    || (coverMedia && "media_url" in coverMedia ? coverMedia.media_url : coverMedia?.url)
    || (firstMedia && "media_url" in firstMedia ? firstMedia.media_url : firstMedia?.url)
    || fallbackImage;

  const profiles = "creator" in pkg ? pkg.creator?.influencer_profiles : undefined;
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  const influencer = "influencer" in pkg ? pkg.influencer : null;
  const creator = "creator" in pkg ? pkg.creator : null;
  const creatorName = creator?.full_name || influencer?.display_name || "Marketplace creator";
  const instagramHandle = profile?.instagram_handle || influencer?.instagram_handle;
  const tiktokHandle = profile?.tiktok_handle;
  const followerCount = profile?.follower_count ?? influencer?.follower_count;
  const avatarUrl = creator?.avatar_url ?? null;

  const destination = [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", ");
  const tripLength = formatTripLength(pkg.duration_days);
  const days = pkg.days ?? [];
  const dayImages = assignDayImages(days.length, media, cover);
  const tags = pkg.tags ?? [];

  const timelineInput: CreatorPackageDetail = {
    package_id: pkg.package_id,
    title: pkg.title,
    duration_days: pkg.duration_days || days.length || 1,
    destination_city: pkg.destination_city,
    destination_country: pkg.destination_country,
    flights: pkg.flights ?? [],
    hotels: pkg.hotels ?? [],
    activities: pkg.activities ?? [],
    days: days.map((d) => ({ id: d.id ?? null, day_number: d.day_number ?? null, title: d.title ?? null, summary: d.summary ?? null })),
  };
  const builderDays = buildDaysFromPackage(timelineInput);

  const legs = [...(pkg.flights ?? [])].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
  const outboundFlight = legs.find((f) => f.day_number === 1) ?? legs[0] ?? null;
  const returnFlight = legs.length > 1 ? legs[legs.length - 1] : null;
  const primaryHotel = pkg.hotels?.[0] ?? null;
  const hotelNights = primaryHotel?.check_in_day != null && primaryHotel?.check_out_day != null
    ? primaryHotel.check_out_day - primaryHotel.check_in_day
    : null;
  const season = pkg.season ?? SEASON_BY_PACKAGE[pkg.package_id ?? ""] ?? null;
  // The vibe comes from the six wizard picks — persisted on the package as
  // vibe ids/engine keywords in `tags` (see lib/vibes.ts). suitable_for is the
  // audience field ("couples, first-timers"), not a vibe, so it isn't used here.
  const vibeLabel = vibeLabelsFromTags(pkg.tags).join(" & ") || null;

  // Booking-request options — every choice is a real catalog row: departure
  // dates are days the outbound route actually flies, the flight selects list
  // same-route alternatives on the chosen dates, and the hotel select lists
  // other properties in the destination city. The estimate adjusts
  // base_price × travelers by the chosen rows' real price deltas.
  const [departure, setDeparture] = useState(outboundFlight?.departure_datetime?.slice(0, 10) ?? "");
  const [travelers, setTravelers] = useState(2);
  const [outboundSel, setOutboundSel] = useState(outboundFlight?.flight_id ?? "");
  const [returnSel, setReturnSel] = useState(returnFlight?.flight_id ?? "");
  const [hotelSel, setHotelSel] = useState(primaryHotel?.hotel_id ?? "");
  const maxTravelers = pkg.max_group_size ?? 8;
  // Anchor the return date to the real gap between the seeded flight legs —
  // junction day_number can disagree with the actual departure dates (the
  // Osaka return is slotted day 10 but its flight departs on day 11). Falls
  // back to day_number when leg datetimes are missing.
  const outDep = outboundFlight?.departure_datetime?.slice(0, 10) ?? null;
  const retDep = returnFlight?.departure_datetime?.slice(0, 10) ?? null;
  const returnDayOffset = outDep && retDep
    ? Math.round((Date.parse(`${retDep}T12:00:00Z`) - Date.parse(`${outDep}T12:00:00Z`)) / 86400000)
    : (returnFlight?.day_number ?? pkg.duration_days ?? 1) - 1;
  const returnDate = dateAfter(departure, returnDayOffset);

  // Compact labels — the card is 360px wide, so options lead with
  // airline/flight-number + price; cabin sits in the helper under the select.
  const flightOption = (f: { airline?: string | null; flight_number?: string | null; flight_id?: string | null; cabin_class?: string | null; departure_datetime?: string | null; price_aud?: number | null }) => ({
    id: f.flight_id ?? "",
    label: [
      [f.airline, f.flight_number ?? f.flight_id?.split("-")[0]].filter(Boolean).join(" "),
      f.price_aud != null ? detailPrice(f.price_aud) : null,
    ].filter(Boolean).join(" · "),
    price: f.price_aud ?? 0,
    cabin: f.cabin_class ?? null,
  });
  // Options are the real catalog rows on the chosen date (the package's own
  // flight is a catalog row too, so it appears through the same filter). When
  // the catalog is empty/unloaded, the curated flight stays as the fallback.
  const outOnDate = flightsOn(catalog?.outbound, departure);
  const outboundOptions = outOnDate.length
    ? outOnDate.map(flightOption)
    : outboundFlight ? [flightOption(outboundFlight)] : [];
  const retOnDate = flightsOn(catalog?.returnLeg, returnDate);
  const returnOptions = retOnDate.length
    ? retOnDate.map(flightOption)
    : returnFlight ? [flightOption(returnFlight)] : [];
  const hotelOption = (h: { hotel_id?: string | null; hotel_name?: string | null; room_type?: string | null; star_rating?: number | null; price_per_night_aud?: number | null }) => ({
    id: h.hotel_id ?? "",
    label: [h.hotel_name, h.price_per_night_aud != null ? detailPrice(h.price_per_night_aud) : null].filter(Boolean).join(" · "),
    nightly: h.price_per_night_aud ?? 0,
    meta: [h.room_type, h.star_rating != null ? `${h.star_rating}★` : null].filter(Boolean).join(" · "),
  });
  const hotelOptions = [
    ...(primaryHotel ? [hotelOption(primaryHotel)] : []),
    ...(catalog?.hotels ?? [])
      .filter((h) => h.hotel_id !== primaryHotel?.hotel_id)
      .map(hotelOption),
  ];
  const departureDates = [...new Set([departure, ...(catalog?.outbound ?? []).map((f) => f.departure_datetime.slice(0, 10))].filter(Boolean))].sort();

  const changeDeparture = (date: string) => {
    setDeparture(date);
    const outs = flightsOn(catalog?.outbound, date);
    if (outs.length && !outs.some((f) => f.flight_id === outboundSel)) setOutboundSel(outs[0].flight_id);
    const rets = flightsOn(catalog?.returnLeg, dateAfter(date, returnDayOffset));
    if (rets.length && !rets.some((f) => f.flight_id === returnSel)) setReturnSel(rets[0].flight_id);
  };

  const selOutbound = outboundOptions.find((o) => o.id === outboundSel);
  const selReturn = returnOptions.find((o) => o.id === returnSel);
  const selHotel = hotelOptions.find((o) => o.id === hotelSel);
  const flightDelta = (selOutbound?.price ?? outboundFlight?.price_aud ?? 0) - (outboundFlight?.price_aud ?? 0)
    + (selReturn?.price ?? returnFlight?.price_aud ?? 0) - (returnFlight?.price_aud ?? 0);
  const estimateTotal = estimateBookingTotal({
    basePrice: pkg.base_price_aud ?? null,
    travelers,
    flightDelta,
    hotelNightlyDelta: (selHotel?.nightly ?? primaryHotel?.price_per_night_aud ?? 0) - (primaryHotel?.price_per_night_aud ?? 0),
    nights: hotelNights ?? 1,
  });

  // Conversion signals grounded in real rows: the locked-tip count is the
  // number of components that actually carry creator notes, and the approval
  // line only shows for packages that passed review (status = live).
  const tipCount = [...(pkg.flights ?? []), ...(pkg.hotels ?? []), ...(pkg.activities ?? [])]
    .filter((c) => c.notes?.trim()).length;
  const avgRating = reviews?.length
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : null;

  const includedItems = [
    outboundFlight && {
      icon: <StopIcon name="plane" size={20} stroke={color.action} />,
      label: "Return flights",
      value: [iataCode(outboundFlight.origin_iata), iataCode(outboundFlight.destination_iata)].filter(Boolean).join(" – "),
      sub: outboundFlight.airline ?? null,
    },
    primaryHotel && {
      icon: <StopIcon name="hotel" size={20} stroke={color.action} />,
      label: "Your stay",
      value: primaryHotel.hotel_name,
      sub: [primaryHotel.star_rating ? `${primaryHotel.star_rating}★` : null, hotelNights ? `${hotelNights} nights` : null].filter(Boolean).join(" · "),
    },
    (pkg.activities?.length ?? 0) > 0 && {
      icon: <StopIcon name="star" size={20} stroke={color.action} />,
      label: "Experiences",
      value: `${pkg.activities.length} activities included`,
      sub: [...new Set(pkg.activities.map((a) => a.category).filter(Boolean))].slice(0, 3).join(" · "),
    },
    season && {
      icon: <SnowflakeIcon />,
      label: "Season",
      value: season,
      sub: null,
    },
    vibeLabel && {
      icon: <HeartIcon />,
      label: "Vibe & style",
      value: vibeLabel,
      sub: null,
    },
  ].filter((item): item is { icon: React.ReactElement; label: string; value: string; sub: string | null } => Boolean(item && item.value));

  // ponytail: no highlights field exists — the first stops of the itinerary are
  // its anchor experiences, so surface up to four activity names as chips.
  const highlightActivities = [...new Set((pkg.activities ?? []).map((a) => a.activity_name).filter((n): n is string => Boolean(n)))].slice(0, 4);

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: pkg.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareStatus("Link copied");
      setTimeout(() => setShareStatus(""), 2000);
    } catch {
      // Share sheet dismissed by the user — nothing to report.
    }
  };

  return (
    <main style={{ background: color.surface, minHeight: "100vh", color: color.textPrimary }}>
      <div style={{ width: "min(calc(100% - 48px), 1280px)", margin: "0 auto", padding: "0 0 96px" }}>
        {previewLabel && <div className="creator-preview-notice" role="status" style={{ margin: "24px 0" }}><strong>{previewLabel}</strong><span>Only you can view this package until it is published.</span></div>}

        <HeroOverlay image={cover} alt={pkg.title} height={560} fullBleed overlayTop={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                border: "none", borderRadius: radius.pill, padding: "10px 16px",
                background: "rgba(255,255,255,0.94)", color: color.textPrimary,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)", backdropFilter: "blur(6px)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              {backLabel}
            </button>
            {!previewLabel && (
              <button
                type="button"
                onClick={() => void handleShare()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  border: "none", borderRadius: radius.pill, padding: "10px 16px",
                  background: "rgba(255,255,255,0.94)", color: color.textPrimary,
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)", backdropFilter: "blur(6px)",
                }}
              >
                <ShareIcon />
                {shareStatus || "Share"}
              </button>
            )}
          </div>
        }>
          <h1 style={{ margin: "0 0 16px", fontFamily: displayFont, fontSize: 72, lineHeight: 1.02, letterSpacing: "-0.02em", fontWeight: 800, maxWidth: 900 }}>{pkg.title}</h1>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>
            {destination && (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><PinIcon /> {destination}</span>
            )}
            {tripLength && (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><CalendarIcon /> {tripLength}</span>
            )}
            {pkg.max_group_size ? (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><PeopleIcon /> Max {pkg.max_group_size} travelers</span>
            ) : null}
          </div>
        </HeroOverlay>

        {/* All content stacks in the left column; the booking card rides the
            right rail, sticking to the viewport for the whole page. */}
        <div style={{ display: "flex", gap: 48, alignItems: "flex-start", paddingTop: 48 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {(pkg.description || !previewLabel) && (
              <section>
                {pkg.description && (
                  <>
                    <SectionTitle>About this journey</SectionTitle>
                    <p style={{ margin: "16px 0 0", fontSize: 18, lineHeight: 1.6, color: color.textSecondary, maxWidth: 720 }}>{pkg.description}</p>
                  </>
                )}
                {!previewLabel && (
                  <section style={{
                    marginTop: pkg.description ? 24 : 0,
                    border: `1px solid ${color.border}`, borderRadius: radius.lg, padding: 24,
                    display: "flex", gap: 16, alignItems: "center",
                  }}>
                    <div style={{ width: 64, height: 64, borderRadius: radius.pill, overflow: "hidden", border: `1px solid ${color.border}`, flexShrink: 0, background: color.surfaceSubtle, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={creatorName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ fontSize: 22, fontWeight: 700, color: color.textSecondary }}>{initials(creatorName)}</span>
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={eyebrowStyle}>Curated by</p>
                      <h2 style={{ margin: "2px 0 0", fontFamily: displayFont, fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{creatorName}</h2>
                      <p style={{ margin: "6px 0 0", fontSize: 14, color: color.textSecondary, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        {instagramHandle && (
                          <a href={`https://instagram.com/${instagramHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: color.action, textDecoration: "underline", textUnderlineOffset: 3, fontWeight: 600 }}>
                            <InstagramIcon /> {instagramHandle}
                          </a>
                        )}
                        {tiktokHandle && (
                          <a href={`https://tiktok.com/@${tiktokHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: color.textSecondary, fontWeight: 600 }}>
                            <TikTokIcon /> {tiktokHandle}
                          </a>
                        )}
                        {followerCount != null && (
                          <span>{(instagramHandle || tiktokHandle) && "· "}{new Intl.NumberFormat("en-US", { notation: "compact" }).format(followerCount)} followers</span>
                        )}
                      </p>
                      {profile?.bio && <p style={{ margin: "8px 0 0", fontSize: 14, color: color.textSecondary, lineHeight: 1.6 }}>{profile.bio}</p>}
                    </div>
                  </section>
                )}
              </section>
            )}

            {includedItems.length > 0 && (
              <section style={{ paddingTop: 48 }}>
                <p style={eyebrowStyle}>Included in this trip</p>
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.border}`,
                  marginTop: 16,
                }}>
                  {includedItems.map((item) => (
                    <div key={item.label} style={{ padding: "20px 24px 20px 0" }}>
                      {/* Icon centers on the label+value pair — the optional sub hangs
                          below as a footnote, so short items don't leave the icon drooping. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <span aria-hidden="true" style={{
                          width: 44, height: 44, borderRadius: radius.pill, flexShrink: 0,
                          background: color.infoSubtle, color: color.action,
                          display: "grid", placeItems: "center",
                        }}>
                          {item.icon}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <p style={eyebrowStyle}>{item.label}</p>
                          <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{item.value}</p>
                        </div>
                      </div>
                      {item.sub && <p style={{ margin: "2px 0 0 58px", fontSize: 13, color: color.textSecondary, lineHeight: 1.4 }}>{item.sub}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {highlightActivities.length > 0 && (
              <section style={{ paddingTop: 48 }}>
                <SectionTitle>Trip highlights</SectionTitle>
                <div style={{ marginTop: 20, background: color.surfaceSubtle, borderRadius: radius.lg, padding: 24 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {highlightActivities.map((name) => (
                      <span key={name} style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        background: color.surface, borderRadius: radius.pill,
                        padding: "9px 16px", fontSize: 14, fontWeight: 600,
                        boxShadow: "0 1px 2px rgba(33,33,33,0.08)",
                      }}>
                        <span style={{ color: color.action, display: "inline-flex" }}><StopIcon name="star" size={15} stroke={color.action} /></span>
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <section style={{ paddingTop: 48, display: "flex", flexDirection: "column", gap: 24 }}>
              <SectionTitle>Day by day</SectionTitle>
              {days.length > 0 ? days.map((day, index) => {
                const key = day.id || String(day.day_number ?? index);
                const dayItems = builderDays[index]?.items ?? [];
                return (
                  <DayCard
                    key={key}
                    day={day}
                    index={index}
                    image={dayImages[index]}
                    items={dayItems}
                    stopImages={buildStopImages(dayItems.length, media, cover)}
                    expanded={expandedDays.has(key)}
                    onToggle={() => toggleDay(key)}
                    onOpenPhoto={(images, photoIndex) => setLightbox({ images, index: photoIndex })}
                  />
                );
              }) : (
                <p style={{ color: color.textSecondary }}>Itinerary details coming soon.</p>
              )}
            </section>

            {reviews && reviews.length > 0 && (
              <section style={{ paddingTop: 48, display: "flex", flexDirection: "column", gap: 24 }}>
                <SectionTitle>Traveller reviews</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {reviews.map((r) => {
                    const reviewer = r.profiles?.full_name?.trim() || "Verified traveller";
                    return (
                      <div key={r.review_id} style={{ display: "flex", gap: 16, padding: "20px 24px", background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.lg }}>
                        {r.profiles?.avatar_url ? (
                          <img src={r.profiles.avatar_url} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: "50%", background: color.surfaceSubtle, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14, fontWeight: 700, color: color.textSecondary }}>{initials(reviewer)}</div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: color.textPrimary }}>
                            {reviewer}
                            <span style={{ marginLeft: 10, color: color.action }}>★ {r.rating}</span>
                          </p>
                          {r.comment && <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.5, color: color.textSecondary }}>{r.comment}</p>}
                          <p style={{ margin: "8px 0 0", fontSize: 12, color: color.textDisabled }}>{formatDateLabel(r.created_at.slice(0, 10))}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <aside style={{ width: 360, flexShrink: 0, position: "sticky", top: 24, border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surfaceSubtle, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <p style={eyebrowStyle}>Investment</p>
              <p style={{ margin: "4px 0 0", fontFamily: displayFont, fontSize: 36, fontWeight: 800 }}>{detailPrice(pkg.base_price_aud ?? null)}</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: color.textSecondary }}>Per person</p>
              {avgRating != null && (
                <p style={{ margin: "8px 0 0", fontSize: 13, color: color.textSecondary }}>
                  <span style={{ color: color.action, fontWeight: 700 }}>★ {avgRating.toFixed(1)}</span> · {reviews!.length} {reviews!.length === 1 ? "review" : "reviews"}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.border}`, padding: "24px 0" }}>
              <div>
                <p style={eyebrowStyle}>Departure</p>
                {departureDates.length > 1 ? (
                  <select value={departure} onChange={(e) => changeDeparture(e.target.value)} style={fieldStyle}>
                    {departureDates.map((d) => (
                      <option key={d} value={d}>{formatDateLabel(d)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="date"
                    value={departure}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => changeDeparture(e.target.value)}
                    style={fieldStyle}
                  />
                )}
                {returnDate && <p style={{ margin: "6px 0 0", fontSize: 12, color: color.textSecondary }}>Returns {formatDateLabel(returnDate)}</p>}
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
              {outboundFlight && outboundOptions.length > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <p style={eyebrowStyle}>Outbound flight</p>
                  <select value={outboundSel} onChange={(e) => setOutboundSel(e.target.value)} style={fieldStyle}>
                    {outboundOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  {selOutbound?.cabin && <p style={{ margin: "6px 0 0", fontSize: 12, color: color.textSecondary }}>{selOutbound.cabin.replace(/_/g, " ")} class</p>}
                </div>
              )}
              {returnFlight && returnOptions.length > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <p style={eyebrowStyle}>Return flight</p>
                  <select value={returnSel} onChange={(e) => setReturnSel(e.target.value)} style={fieldStyle}>
                    {returnOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  {selReturn?.cabin && <p style={{ margin: "6px 0 0", fontSize: 12, color: color.textSecondary }}>{selReturn.cabin.replace(/_/g, " ")} class</p>}
                </div>
              )}
              {primaryHotel && hotelOptions.length > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <p style={eyebrowStyle}>Hotel</p>
                  <select value={hotelSel} onChange={(e) => setHotelSel(e.target.value)} style={fieldStyle}>
                    {hotelOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  {selHotel?.meta && <p style={{ margin: "6px 0 0", fontSize: 12, color: color.textSecondary }}>{selHotel.meta}</p>}
                </div>
              )}
            </div>

            {tags.length > 0 && (
              <div>
                <p style={{ ...eyebrowStyle, marginBottom: 12 }}>Themes</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {tags.map((tag) => (
                    <span key={tag} style={{ padding: "6px 12px", borderRadius: radius.pill, border: `1px solid ${color.border}`, background: color.surface, fontSize: 13, color: color.textSecondary }}>{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {!previewLabel && (
              <div>
                {estimateTotal != null && (
                  <p style={{ margin: "0 0 12px", fontSize: 14, color: color.textSecondary, textAlign: "center" }}>
                    Estimated total for {travelers} {travelers === 1 ? "traveler" : "travelers"}: <strong style={{ color: color.textPrimary, fontSize: 15 }}>{detailPrice(estimateTotal)}</strong>
                  </p>
                )}
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  style={{ width: "100%", padding: "16px 24px", border: "none", borderRadius: radius.md, background: color.action, color: color.surface, fontSize: 15, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "not-allowed", opacity: 0.6 }}
                >
                  Request booking
                </button>
                <p style={{ margin: "8px 0 0", fontSize: 11, textAlign: "center", color: color.textDisabled }}>Booking requests aren&apos;t available yet</p>
                <div style={{ marginTop: 16, borderTop: `1px solid ${color.border}`, paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  {pkg.status === "live" && (
                    <p style={{ margin: 0, fontSize: 12, color: color.textSecondary, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: color.action, display: "inline-flex" }}><CheckIcon /></span>
                      Reviewed &amp; approved by our travel team
                    </p>
                  )}
                  {tipCount > 0 && (
                    <p style={{ margin: 0, fontSize: 12, color: color.textSecondary, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-flex" }}><LockIcon /></span>
                      {tipCount} insider tips unlock with purchase
                    </p>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(nextIndex) => setLightbox({ images: lightbox.images, index: nextIndex })}
        />
      )}
    </main>
  );
}

export function MarketplaceDetailScreen({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [pkg, setPackage] = useState<MarketplacePackageDetail | null>(null);
  const [catalog, setCatalog] = useState<CatalogOptions | null>(null);
  const [reviews, setReviews] = useState<MarketplaceReview[] | null>(null);
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

  // The booking card's real choices: other dated departures on the package's
  // flight routes and other hotels in the destination city. Catalog tables
  // are public-read (RLS) so the anon client can query them directly.
  useEffect(() => {
    if (!pkg) return;
    let active = true;
    const legs = [...(pkg.flights ?? [])].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0));
    const out = legs.find((f) => f.day_number === 1) ?? legs[0];
    const ret = legs.length > 1 ? legs[legs.length - 1] : null;
    const flightCols = "flight_id,airline,departure_datetime,cabin_class,price_aud";
    const today = new Date().toISOString();
    void Promise.all([
      out?.origin_iata && out?.destination_iata
        ? supabase.from("flights").select(flightCols).ilike("origin", iataPattern(out.origin_iata)).ilike("destination", iataPattern(out.destination_iata)).gte("departure_datetime", today).order("departure_datetime").limit(200)
        : Promise.resolve({ data: null }),
      ret?.origin_iata && ret?.destination_iata
        ? supabase.from("flights").select(flightCols).ilike("origin", iataPattern(ret.origin_iata)).ilike("destination", iataPattern(ret.destination_iata)).gte("departure_datetime", today).order("departure_datetime").limit(200)
        : Promise.resolve({ data: null }),
      pkg.destination_city
        ? supabase.from("hotels").select("hotel_id,hotel_name,star_rating,room_type,price_per_night_aud").eq("city", pkg.destination_city).order("price_per_night_aud")
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
  }, [pkg]);

  // Public-read reviews for the social-proof block. `profiles` resolves via
  // the customer_id FK (anon-readable); a missing row falls back to a generic
  // "Verified traveller" label.
  useEffect(() => {
    if (!pkg?.package_id) return;
    let active = true;
    void supabase
      .from("package_reviews")
      .select("review_id,rating,comment,created_at,profiles(full_name,avatar_url)")
      .eq("package_id", pkg.package_id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setReviews((data ?? []).map((r) => ({
          review_id: r.review_id as string,
          rating: r.rating as number,
          comment: (r.comment ?? null) as string | null,
          created_at: r.created_at as string,
          // many-to-one embed — supabase types it as an array
          profiles: (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as MarketplaceReview["profiles"],
        })));
      });
    return () => { active = false; };
  }, [pkg?.package_id]);

  if (loading) return <p role="status" style={{ padding: 64, textAlign: "center" }}>Loading trip…</p>;
  if (error) return (
    <main style={{ padding: 64, textAlign: "center" }}>
      <p role="alert" style={{ color: color.error }}>{error}</p>
      <button type="button" onClick={() => void loadPackage()} style={{ padding: "12px 20px", border: `1px solid ${color.border}`, borderRadius: radius.md, background: color.surface, cursor: "pointer" }}>Try again</button>
    </main>
  );
  if (!pkg) return null;

  return <PackageDetailView pkg={pkg} catalog={catalog} reviews={reviews} backLabel="Back to marketplace" onBack={() => router.push("/marketplace")} />;
}
