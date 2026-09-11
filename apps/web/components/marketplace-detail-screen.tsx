"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchMarketplacePackage, type MarketplacePackageDetail } from "../lib/marketplace-api";
import { assignDayImages, buildStopImages, formatTripLength, initials } from "../lib/marketplace-detail";
import { buildDaysFromPackage, type TimelineItem } from "../lib/itinerary-builder";
import type { CreatorPackageDetail } from "../lib/creator-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const fallbackImage = "https://images.unsplash.com/photo-1510391532992-e1b94a277a3a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1400";

// Design tokens from apps/web/design/design-tokens.json — keep this page on
// the same system as the rest of the marketplace rather than one-off values.
const color = {
  action: "#0072EA",
  surface: "#FFFFFF",
  surfaceSubtle: "#F5F5F5",
  textPrimary: "#212121",
  textSecondary: "#616161",
  textDisabled: "#9E9E9E",
  border: "#E0E0E0",
};
const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

function detailPrice(price: number | null) {
  if (price === null) return "Price on request";
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD", maximumFractionDigits: 0,
  }).format(price);
}

function HeroOverlay({ image, alt, children, height, radiusPx = radius.lg, fullBleed = false }: { image: string; alt: string; children: React.ReactNode; height: number; radiusPx?: number; fullBleed?: boolean }) {
  return (
    <div style={{
      position: "relative", height, overflow: "hidden", border: `1px solid ${color.border}`,
      ...(fullBleed
        ? { width: "100vw", marginLeft: "calc(50% - 50vw)", marginRight: "calc(50% - 50vw)", borderLeft: 0, borderRight: 0 }
        : { borderRadius: radiusPx }),
    }}>
      <img src={image} alt={alt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 60%)" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: fullBleed ? "0 max(24px, calc((100vw - 1280px) / 2 + 24px)) 48px" : 24, color: "#FFFFFF" }}>
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

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.3" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6" /><path d="M16 4.3a3 3 0 0 1 0 5.8M20 20c0-2.8-2-5.1-4.7-5.8" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
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

// Same icon language as the package editor (apps/web/components/itinerary-editor.tsx's
// local `Icon`) so a flight/hotel/activity stop looks identical wherever it shows up.
function StopIcon({ name, size = 20 }: { name: TimelineItem["icon"]; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plane: <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />,
    hotel: <><path d="M3 20V7m18 13V11a2 2 0 0 0-2-2h-7v11M3 14h18M7 10h2" /><path d="M3 20h18" /></>,
    star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color.textPrimary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
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

// Prefer whatever real detail the item actually carries; only fall back to a
// generic (non-fabricated) line when the creator never filled one in.
function itemDetailText(item: TimelineItem): string {
  return item.notes || item.roomType || item.address || "Full details for this stop unlock when you request this itinerary.";
}

function PremiumTip({ text }: { text: string }) {
  return (
    <div style={{ padding: "16px 20px", background: color.surfaceSubtle, borderLeft: `3px solid ${color.textPrimary}` }}>
      <p style={{ margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: color.textPrimary }}>
        <LockIcon /> Premium tip
      </p>
      <p aria-hidden="true" style={{ margin: 0, fontSize: 13, fontStyle: "italic", color: color.textSecondary, filter: "blur(4px)", userSelect: "none" }}>{text}</p>
      <p style={{ margin: "8px 0 0", fontSize: 11, color: color.textDisabled }}>Unlocks when you request this itinerary.</p>
    </div>
  );
}

function DayCard({
  day, index, image, items, stopImages, expanded, onToggle, onOpenPhoto,
}: {
  day: { id?: string; day_number?: number; title?: string; summary?: string };
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
          <h3 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.01em", textTransform: "uppercase" }}>{label}</h3>
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
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: color.textSecondary }}>
                    <StopIcon name={item.icon} size={16} /> {item.time} · {item.type}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700, color: color.textPrimary }}>{item.title}</p>
                  {item.subtitle && <p style={{ margin: "2px 0 0", fontSize: 13, color: color.textSecondary }}>{item.subtitle}</p>}
                </div>
              </div>
              {itemIndex > 0 && (
                <div style={{ padding: "0 24px 24px" }}>
                  <PremiumTip text={itemDetailText(item)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MarketplaceDetailScreen({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [pkg, setPackage] = useState<MarketplacePackageDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
      <p role="alert" style={{ color: "#D40119" }}>{error}</p>
      <button type="button" onClick={() => void loadPackage()} style={{ padding: "12px 20px", border: `1px solid ${color.border}`, borderRadius: radius.md, background: color.surface, cursor: "pointer" }}>Try again</button>
    </main>
  );
  if (!pkg) return null;

  const destination = [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", ");
  const cover = pkg.cover_image_url || pkg.media?.find((item) => item.is_cover)?.media_url || pkg.media?.[0]?.media_url || pkg.media?.[0]?.url || fallbackImage;
  const tripLength = formatTripLength(pkg.duration_days);
  const days = pkg.days ?? [];
  const dayImages = assignDayImages(days.length, pkg.media, cover);
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

  const profiles = pkg.creator?.influencer_profiles;
  const profile = Array.isArray(profiles) ? profiles[0] : profiles;
  const creatorName = pkg.creator?.full_name || pkg.influencer?.display_name || "Marketplace creator";
  const instagramHandle = profile?.instagram_handle || pkg.influencer?.instagram_handle;
  const tiktokHandle = profile?.tiktok_handle;
  const followerCount = profile?.follower_count ?? pkg.influencer?.follower_count;

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
      <div style={{ width: "min(calc(100% - 48px), 1280px)", margin: "0 auto", padding: "40px 0 96px" }}>
        <button type="button" onClick={() => router.push("/marketplace")} style={{ border: 0, background: "none", padding: "8px 0", marginBottom: 24, cursor: "pointer", fontSize: 15, textDecoration: "underline" }}>← Back to marketplace</button>

        <HeroOverlay image={cover} alt={pkg.title} height={560} fullBleed>
          <h1 style={{ margin: "0 0 16px", fontSize: 72, lineHeight: 1.02, letterSpacing: "-0.02em", fontWeight: 800, maxWidth: 900 }}>{pkg.title}</h1>
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

        <div style={{ display: "flex", gap: 32, alignItems: "flex-start", paddingTop: 40 }}>
          <div style={{ width: 128, height: 128, borderRadius: radius.pill, overflow: "hidden", border: `1px solid ${color.border}`, flexShrink: 0, background: color.surfaceSubtle, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {pkg.creator?.avatar_url ? (
              <img src={pkg.creator.avatar_url} alt={creatorName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: 36, fontWeight: 700, color: color.textSecondary }}>{initials(creatorName)}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 28 }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: color.textSecondary }}>Curated by </span>
                {creatorName}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {instagramHandle && (
                  <a href={`https://instagram.com/${instagramHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: color.action, textDecoration: "underline" }}>
                    <InstagramIcon /> @{instagramHandle.replace(/^@/, "")}
                  </a>
                )}
                {tiktokHandle && (
                  <a href={`https://tiktok.com/@${tiktokHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: color.textSecondary }}>
                    <TikTokIcon /> {tiktokHandle.replace(/^@/, "")}
                  </a>
                )}
                {(instagramHandle || tiktokHandle) && <div style={{ width: 1, height: 16, background: color.border }} />}
                <button type="button" onClick={() => void handleShare()} style={{ display: "flex", alignItems: "center", gap: 6, border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: color.textSecondary }}>
                  <ShareIcon /> {shareStatus || "Share"}
                </button>
              </div>
            </div>
            {followerCount != null && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: color.textSecondary }}>{new Intl.NumberFormat("en-US", { notation: "compact" }).format(followerCount)} followers</p>
            )}
            {profile?.bio && <p style={{ margin: "12px 0 0", color: color.textSecondary, lineHeight: 1.6, maxWidth: 640 }}>{profile.bio}</p>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 48, alignItems: "flex-start", paddingTop: 40 }}>
          <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 24 }}>
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
                  stopImages={buildStopImages(dayItems.length, pkg.media, cover)}
                  expanded={expandedDays.has(key)}
                  onToggle={() => toggleDay(key)}
                  onOpenPhoto={(images, photoIndex) => setLightbox({ images, index: photoIndex })}
                />
              );
            }) : (
              <p style={{ color: color.textSecondary }}>Itinerary details coming soon.</p>
            )}
          </section>

          <aside style={{ width: 360, flexShrink: 0, border: `1px solid ${color.border}`, borderRadius: radius.lg, background: color.surfaceSubtle, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: color.textSecondary }}>Investment</p>
              <p style={{ margin: "4px 0 0", fontSize: 36, fontWeight: 700 }}>{detailPrice(pkg.base_price_aud)}</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: color.textSecondary, fontStyle: "italic" }}>Per person</p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: pkg.max_group_size ? "1fr 1fr" : "1fr", gap: 16, borderTop: `1px solid ${color.border}`, borderBottom: `1px solid ${color.border}`, padding: "24px 0" }}>
              <div>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: color.textSecondary }}>Duration</p>
                <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 700 }}>{tripLength || "TBC"}</p>
              </div>
              {pkg.max_group_size ? (
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: color.textSecondary }}>Group size</p>
                  <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 700 }}>Max {pkg.max_group_size}</p>
                </div>
              ) : null}
            </div>

            {pkg.tags.length > 0 && (
              <div>
                <p style={{ margin: "0 0 12px", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: color.textPrimary }}>Highlights</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {pkg.tags.map((tag) => (
                    <span key={tag} style={{ padding: "4px 12px", borderRadius: radius.pill, border: `1px solid ${color.border}`, background: color.surface, fontSize: 12, color: color.textSecondary }}>{tag}</span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <button
                type="button"
                disabled
                aria-disabled="true"
                style={{ width: "100%", padding: "16px 24px", border: "none", borderRadius: radius.md, background: color.action, color: color.surface, fontSize: 15, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "not-allowed", opacity: 0.6 }}
              >
                Request booking
              </button>
              <p style={{ margin: "8px 0 0", fontSize: 11, textAlign: "center", color: color.textDisabled }}>Booking requests aren&apos;t available yet</p>
            </div>
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
