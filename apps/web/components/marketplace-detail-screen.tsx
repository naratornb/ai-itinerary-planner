"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchMarketplacePackage, type MarketplacePackageDetail } from "../lib/marketplace-api";
import type { CreatorPackageDetail } from "../lib/creator-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const fallbackImage = "https://images.unsplash.com/photo-1510391532992-e1b94a277a3a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1400";

function detailPrice(price: number | null) {
  if (price === null) return "Price on request";
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD", maximumFractionDigits: 0,
  }).format(price);
}

type DetailPackage = MarketplacePackageDetail | CreatorPackageDetail;

export function PackageDetailView({
  pkg,
  backLabel,
  onBack,
  previewLabel,
}: {
  pkg: DetailPackage;
  backLabel: string;
  onBack: () => void;
  previewLabel?: string;
}) {
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
  const destination = [pkg.destination_city, pkg.destination_country].filter(Boolean).join(", ");

  return (
    <main className="package-detail-page">
      <div className="package-detail-container">
        <button type="button" onClick={onBack} style={{ border: 0, background: "none", padding: "8px 0", marginBottom: 24, cursor: "pointer", fontSize: 15, textDecoration: "underline" }}>← {backLabel}</button>
        {previewLabel && <div className="creator-preview-notice" role="status"><strong>{previewLabel}</strong><span>Only you can view this package until it is published.</span></div>}
        <img className="package-detail-cover" src={cover} alt={pkg.title} />

        <div className="package-detail-layout">
          <section>
            <p style={{ color: "#616161", margin: "0 0 8px" }}>{destination || "Destination coming soon"}{pkg.duration_days ? ` · ${pkg.duration_days} days` : ""}</p>
            <h1 className="package-detail-title">{pkg.title}</h1>
            {pkg.description && <p style={{ color: "#616161", fontSize: 18, lineHeight: 1.65 }}>{pkg.description}</p>}

            {pkg.days && pkg.days.length > 0 && (
              <div style={{ marginTop: 40 }}>
                <h2 style={{ fontSize: 28 }}>Your itinerary</h2>
                <div style={{ display: "grid", gap: 12 }}>
                  {pkg.days.map((day, index) => {
                    const dayId = "package_day_id" in day ? day.package_day_id : day.id;
                    const description = "description" in day ? day.description : day.summary;
                    return (
                      <article key={dayId || day.day_number || index} style={{ border: "1px solid #E0E0E0", borderRadius: 12, padding: 20 }}>
                        <strong>Day {day.day_number || index + 1}{day.title ? ` · ${day.title}` : ""}</strong>
                        {description && <p style={{ color: "#616161", lineHeight: 1.5, marginBottom: 0 }}>{description}</p>}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <aside style={{ border: "1px solid #E0E0E0", borderRadius: 16, padding: 24, height: "fit-content" }}>
            <p style={{ color: "#616161", fontSize: 13, margin: 0 }}>From per person</p>
            <p style={{ fontSize: 30, fontWeight: 700, margin: "4px 0 24px" }}>{detailPrice(pkg.base_price_aud ?? null)}</p>
            {!previewLabel && <div style={{ borderTop: "1px solid #E0E0E0", paddingTop: 20 }}>
              <p style={{ fontWeight: 700, margin: "0 0 4px" }}>{creatorName}</p>
              {(profile?.instagram_handle || influencer?.instagram_handle) && <p style={{ color: "#616161", margin: "0 0 8px" }}>{profile?.instagram_handle || influencer?.instagram_handle}</p>}
              {profile?.bio && <p style={{ color: "#616161", lineHeight: 1.5, marginBottom: 0 }}>{profile.bio}</p>}
            </div>}
          </aside>
        </div>
      </div>
    </main>
  );
}

export function MarketplaceDetailScreen({ packageId }: { packageId: string }) {
  const router = useRouter();
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
      <p role="alert" style={{ color: "#D40119" }}>{error}</p>
      <button type="button" onClick={() => void loadPackage()} style={{ padding: "12px 20px", border: "1px solid #E0E0E0", borderRadius: 12, background: "white", cursor: "pointer" }}>Try again</button>
    </main>
  );
  if (!pkg) return null;

  return <PackageDetailView pkg={pkg} backLabel="Back to marketplace" onBack={() => router.push("/marketplace")} />;
}
