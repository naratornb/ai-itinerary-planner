"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";

import {
  createPackage,
  deletePackage,
  fetchOwnPackage,
  fetchOwnPackages,
  formatCreatorPackage,
  resolveCreatorProfile,
  signInWithEmail,
  type CreatePackageInput,
  type CreatorPackage,
} from "../lib/creator-api";
import {
  fetchMarketplacePackages,
  searchMarketplacePackages,
  uniqueDestinationSuggestions,
  type MarketplacePackageSummary,
} from "../lib/marketplace-api";
import {
  generateItinerary,
  itineraryToPackageInput,
  type WizardSelection,
} from "../lib/ai/itinerary";
import { parseWizardVibesDraft, wizardVibesStorageKey } from "../lib/review-draft";
import { supabase } from "../lib/supabase/client";
import { creatorPackageRoute } from "../lib/routes";
import { creatorDashboardBackLink, dashboardActionAlignment } from "./navigation-model";
const creatorBannerImg = "/creator-banner.png";


export type Screen = "login" | "marketplace" | "dashboard" | "builder" | "manual-builder" | "ai-wizard";

export function nextRecommendationInfoOpen(
  open: boolean,
  interaction: "focus" | "click" | "leave",
) {
  return interaction === "leave" ? false : open || interaction === "focus" || interaction === "click";
}

// ─── Image URLs ────────────────────────────────────────────────────────────────
const IMG = {
  hero:      "https://images.unsplash.com/photo-1510391532992-e1b94a277a3a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1400",
  tokyo:     "https://images.unsplash.com/photo-1573455494060-c5595004fb6c?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=800",
  iceland:   "https://images.unsplash.com/photo-1488415032361-b7e238421f1b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=800",
  bali:      "https://images.unsplash.com/photo-1711609110590-5ad5c4599e56?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=800",
  morocco:   "https://images.unsplash.com/photo-1489749798305-4fea3ae63d43?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=800",
  santorini: "https://images.unsplash.com/photo-1560703650-ef3e0f254ae0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=800",
  maldives:  "https://images.unsplash.com/photo-1514282401047-d79a71a590e8?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=800",
};

// ─── DS Tokens (mirrors CSS custom properties) ─────────────────────────────────
const C = {
  red:           "#D40119",
  blue:          "#0072EA",   // PRIMARY action colour
  blueDark:      "#005DC7",
  ink:           "#212121",
  secondary:     "#616161",
  disabled:      "#9E9E9E",
  white:         "#FFFFFF",
  subtle:        "#F5F5F5",
  border:        "#E0E0E0",
  success:       "#14804A",
  successBg:     "#ECFDF5",
  warning:       "#A45B00",
  warningBg:     "#FFF8EC",
  focusRing:     "rgba(0,114,234,0.35)",
  shadowCard:    "0 1px 3px rgba(33,33,33,0.07)",
  shadowRaised:  "0 2px 8px rgba(33,33,33,0.09)",
  radiusMd:      12,
  radiusLg:      16,
  radiusPill:    999,
};

export function destinationOptionBackground(selected: boolean, hovered: boolean) {
  if (selected) return "#EFF6FF";
  return hovered ? C.subtle : "transparent";
}

// ─── Button primitives ─────────────────────────────────────────────────────────
// Primary: blue fill, white text — "an action the user can take"
function BtnPrimary({
  children, onClick, type = "button", full = false,
}: {
  children: React.ReactNode; onClick?: () => void; type?: "button" | "submit"; full?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minHeight: 44, padding: "12px 20px",
        width: full ? "100%" : undefined,
        background: hov ? C.blueDark : C.blue,
        color: C.white,
        border: "none",
        borderRadius: C.radiusMd,
        fontFamily: "var(--fc-font-body)",
        fontSize: 14, fontWeight: 500, lineHeight: "20px",
        cursor: "pointer",
        transition: "background 140ms ease-out",
        gap: 8,
      }}
    >
      {children}
    </button>
  );
}

// Secondary: white fill, ink text, border
function BtnSecondary({
  children, onClick, type = "button", full = false,
}: {
  children: React.ReactNode; onClick?: () => void; type?: "button" | "submit"; full?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minHeight: 44, padding: "12px 20px",
        width: full ? "100%" : undefined,
        background: hov ? C.subtle : C.white,
        color: C.ink,
        border: `1px solid ${C.border}`,
        borderRadius: C.radiusMd,
        fontFamily: "var(--fc-font-body)",
        fontSize: 14, fontWeight: 500, lineHeight: "20px",
        cursor: "pointer",
        transition: "background 140ms ease-out, border-color 140ms ease-out",
        gap: 8,
      }}
    >
      {children}
    </button>
  );
}

// Brand wordmark: Travel Marketplace® and tagline
function MarketplaceBrandLogo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
      <div style={{
        fontFamily: "var(--fc-font-body)", fontWeight: 800,
        fontSize: 24, letterSpacing: "1px", color: "#fff", lineHeight: 1,
        display: "flex", alignItems: "baseline", gap: 1,
      }}>
        Travel Marketplace
        <sup style={{ fontSize: 10, fontWeight: 400, marginLeft: 1 }}>®</sup>
      </div>
      <div style={{
        fontFamily: "var(--fc-font-body)", fontWeight: 400,
        fontSize: 15, color: "rgba(255,255,255,0.9)", lineHeight: 1,
        textAlign: "left", marginBottom: 4,
      }}>
        Your centre for <strong style={{ fontWeight: 700 }}>travel.</strong>
      </div>
    </div>
  );
}

// fc-control / fc-nav-item shared hover style
const navItemBase: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 40, padding: "10px 12px", borderRadius: 12,
  color: "#fff", fontSize: 14, fontWeight: 500, lineHeight: "20px",
  textDecoration: "none", whiteSpace: "nowrap", cursor: "pointer",
  background: "none", border: "none", fontFamily: "var(--fc-font-body)",
  transition: "background-color 140ms ease",
  gap: 8,
};

function MarketplaceControl({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ ...navItemBase, background: hov ? "rgba(0,0,0,0.08)" : "none" }}>
      {children}
    </button>
  );
}

function MarketplaceNavItem({ children, onClick, active }: { children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        ...navItemBase,
        background: active ? "rgba(0,0,0,0.12)" : hov ? "rgba(0,0,0,0.08)" : "none",
      }}>
      {children}
    </button>
  );
}

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ display: "inline-grid", width: 20, height: 20, placeItems: "center", flexShrink: 0 }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

// ─── Top Nav ───────────────────────────────────────────────────────────────────
export function TopNav({ screen, onNav }: { screen: Screen; onNav: (s: Screen) => void }) {
  const isMarketplace = screen === "marketplace";
  const [marketplaceSession, setMarketplaceSession] = useState<Session | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [marketplaceProfile, setMarketplaceProfile] = useState({
    displayName: "Creator",
    email: "",
    initials: "C",
    avatarUrl: null as string | null,
  });

  useEffect(() => {
    let mounted = true;
    const syncSession = async (session: Session | null) => {
      if (!mounted) return;
      setMarketplaceSession(session);
      if (!session) {
        setMarketplaceProfile({ displayName: "Creator", email: "", initials: "C", avatarUrl: null });
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name,avatar_url")
        .eq("id", session.user.id)
        .maybeSingle();
      if (!mounted) return;
      setMarketplaceProfile({
        ...resolveCreatorProfile(profile, session.user.user_metadata, session.user.email ?? ""),
        email: session.user.email ?? "",
      });
    };
    void supabase.auth.getSession().then(({ data }) => syncSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSession(session);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleMarketplaceAccount = async () => {
    if (marketplaceSession) {
      await supabase.auth.signOut();
      setAccountOpen(false);
      return;
    }
    onNav("login");
  };

  return (
    <header style={{
      width: "100%", background: "#d40119", color: "#fff",
    }}>
      <div style={{
        width: "min(calc(100% - 48px), 1248px)",
        margin: "0 auto",
        padding: "82px 24px 12px",
      }}>
        {/* ── Top row: brand + utilities ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 48, paddingBottom: 8, marginBottom: 12,
        }}>
          {/* Brand */}
          <button onClick={() => onNav("marketplace")} aria-label="Travel Marketplace"
            style={{
              display: "flex", alignItems: "center", height: 40,
              background: "none", border: "none", cursor: "pointer", padding: 0, gap: 8,
            }}>
            <MarketplaceBrandLogo />
          </button>

          {/* Utilities */}
          <div style={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
            <MarketplaceControl>
              {/* phone/tablet icon */}
              <svg style={{ display: "inline-grid", width: 20, height: 20, placeItems: "center", flexShrink: 0 }}
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
              </svg>
              Get the app
            </MarketplaceControl>
            <MarketplaceControl>Get a Quote</MarketplaceControl>
            <MarketplaceControl>
              Help
              <Chevron />
            </MarketplaceControl>

            <div style={{ position: "relative" }}>
              <button
                onClick={() => marketplaceSession ? setAccountOpen((open) => !open) : onNav("login")}
                aria-expanded={marketplaceSession ? accountOpen : undefined}
                aria-label={marketplaceSession ? `Open profile menu for ${marketplaceProfile.displayName}` : "Sign in"}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  height: 40, padding: marketplaceSession ? "0 12px 0 4px" : "0 20px",
                  border: 0, borderRadius: 9999,
                  background: C.white, color: C.ink,
                  font: "500 14px/20px var(--fc-font-body)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                {marketplaceSession ? (
                  marketplaceProfile.avatarUrl ? (
                    <img
                      src={marketplaceProfile.avatarUrl}
                      alt=""
                      style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover" }}
                    />
                  ) : (
                    <span aria-hidden="true" style={{
                      width: 30, height: 30, borderRadius: "50%",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "#005B4F", color: C.white, fontSize: 14, fontWeight: 600,
                    }}>
                      {marketplaceProfile.initials}
                    </span>
                  )
                ) : (
                  <span style={{ paddingInline: 8 }}>Sign in</span>
                )}
                {marketplaceSession ? <Chevron /> : null}
              </button>

              {marketplaceSession && accountOpen ? (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  width: 300, background: C.white, color: C.ink,
                  borderRadius: C.radiusMd, border: `1px solid ${C.border}`,
                  boxShadow: C.shadowRaised, overflow: "hidden", zIndex: 200,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 20 }}>
                    {marketplaceProfile.avatarUrl ? (
                      <img
                        src={marketplaceProfile.avatarUrl}
                        alt=""
                        style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <span aria-hidden="true" style={{
                        width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        background: "#005B4F", color: C.white, fontSize: 20, fontWeight: 600,
                      }}>
                        {marketplaceProfile.initials}
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: "0 0 3px", fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {marketplaceProfile.displayName}
                      </p>
                      <p style={{ margin: 0, fontSize: 13, color: C.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {marketplaceProfile.email}
                      </p>
                    </div>
                  </div>
                  <div style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
                    <button onClick={() => { setAccountOpen(false); onNav("dashboard"); }} style={{
                      width: "100%", padding: "14px 20px", textAlign: "left",
                      border: 0, background: C.white, color: C.ink,
                      fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500, cursor: "pointer",
                    }}>
                      Dashboard
                    </button>
                  </div>
                  <button onClick={() => void handleMarketplaceAccount()} style={{
                    width: "100%", padding: "14px 20px", textAlign: "left",
                    border: 0, background: C.white, color: "#C8001A",
                    fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500, cursor: "pointer",
                  }}>
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Bottom row: product nav ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          height: 40,
        }}>
          {/* Navigation */}
          <nav aria-label="Main navigation" style={{ display: "flex", alignItems: "center" }}>
            <MarketplaceNavItem active onClick={() => onNav("marketplace")}>
              <svg style={{ display: "inline-grid", width: 28, height: 28, placeItems: "center", flexShrink: 0 }}
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
              </svg>
              Flights
            </MarketplaceNavItem>

            <MarketplaceNavItem onClick={() => onNav("marketplace")}>
              <svg style={{ display: "inline-grid", width: 20, height: 20, placeItems: "center", flexShrink: 0 }}
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zm0 2c.87 0 1.7.15 2.47.42L5.42 14.47A6.96 6.96 0 0 1 5 12a7 7 0 0 1 7-7zm0 14a7 7 0 0 1-7-7c0-.87.15-1.7.42-2.47l9.05-9.05C18.55 5.47 19 6.68 19 8c0 3.87-3.13 7-7 7z"/>
              </svg>
              Holidays
              <Chevron />
            </MarketplaceNavItem>

            {[
              { label: "Flights + Stays", icon: <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/> },
              { label: "Stays", icon: <path d="M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z"/> },
              { label: "Tours", icon: <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/> },
              { label: "Cruises", icon: <path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/> },
              { label: "Deals", icon: <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/> },
              { label: "Cars", icon: <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/> },
            ].map(({ label, icon }) => (
              <MarketplaceNavItem key={label} onClick={() => onNav("marketplace")}>
                <svg style={{ display: "inline-grid", width: 20, height: 20, placeItems: "center", flexShrink: 0 }}
                  viewBox="0 0 24 24" fill="currentColor">
                  {icon}
                </svg>
                {label}
              </MarketplaceNavItem>
            ))}

            {/* ── Creator Trips — highlighted + NEW badge ── */}
            <MarketplaceNavItem active={isMarketplace} onClick={() => onNav("marketplace")}>
              <svg style={{ display: "inline-grid", width: 20, height: 20, placeItems: "center", flexShrink: 0 }}
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.49L17.5 6.5 9.99 9.99 6.5 17.5zm5.5-6.6c.61 0 1.1.49 1.1 1.1s-.49 1.1-1.1 1.1-1.1-.49-1.1-1.1.49-1.1 1.1-1.1z"/>
              </svg>
              Creator Trips
              <span style={{
                background: "#FFD700", color: "#7A3B00",
                fontFamily: "var(--fc-font-body)", fontSize: 9, fontWeight: 800,
                letterSpacing: "0.06em", textTransform: "uppercase",
                padding: "2px 5px", borderRadius: 4, lineHeight: 1, flexShrink: 0,
              }}>NEW</span>
            </MarketplaceNavItem>

            <MarketplaceNavItem onClick={() => onNav("marketplace")}>
              More
              <Chevron />
            </MarketplaceNavItem>
          </nav>

          {/* Contact */}
          <div style={{ display: "flex", alignItems: "center", marginLeft: "auto" }}>
            <MarketplaceNavItem onClick={() => {}}>Stores</MarketplaceNavItem>
            <MarketplaceNavItem onClick={() => {}}>
              <svg style={{ display: "inline-grid", width: 20, height: 20, placeItems: "center", flexShrink: 0 }}
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
              </svg>
              1300 859 334
            </MarketplaceNavItem>
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── Login Screen ──────────────────────────────────────────────────────────────
export function LoginScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      await signInWithEmail(supabase.auth, email, password);
      onNav("dashboard");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.white,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--fc-font-body)",
    }}>
      {/* Card */}
      <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 0 }}>

        {/* Title */}
        <h1 style={{
          fontSize: 20, fontWeight: 700, color: C.ink,
          margin: "0 0 24px", textAlign: "center", lineHeight: "28px",
        }}>Become a member or sign in</h1>

        {/* Email field — floating label style */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <label style={{
              position: "absolute", top: -9, left: 12, background: C.white,
              padding: "0 4px", fontSize: 12, color: C.secondary, lineHeight: 1,
            }}>Email address *</label>
            <input
              type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              style={{
                width: "100%", boxSizing: "border-box",
                height: 52, padding: "0 14px",
                fontSize: 16, color: C.ink,
                border: `1.5px solid ${C.ink}`, borderRadius: 6, outline: "none",
                fontFamily: "var(--fc-font-body)",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = C.blue; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = C.ink; }}
            />
          </div>

          <div style={{ position: "relative" }}>
            <label htmlFor="creator-password" style={{
              position: "absolute", top: -9, left: 12, background: C.white,
              padding: "0 4px", fontSize: 12, color: C.secondary, lineHeight: 1,
            }}>Password *</label>
            <input
              id="creator-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              minLength={8}
              style={{
                width: "100%", boxSizing: "border-box",
                height: 52, padding: "0 14px",
                fontSize: 16, color: C.ink,
                border: `1.5px solid ${C.ink}`, borderRadius: 6, outline: "none",
                fontFamily: "var(--fc-font-body)",
              }}
              onFocus={(event) => { event.currentTarget.style.borderColor = C.blue; }}
              onBlur={(event) => { event.currentTarget.style.borderColor = C.ink; }}
            />
          </div>

          {errorMessage ? (
            <p role="alert" style={{
              margin: 0, padding: "10px 12px", borderRadius: 6,
              background: "#FFF1F2", color: "#B42318", fontSize: 14, lineHeight: "20px",
            }}>
              {errorMessage}
            </p>
          ) : null}

          {/* Continue button */}
          <button type="submit" disabled={isSubmitting} style={{
            height: 48, background: C.blue, color: C.white,
            fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 500,
            border: "none", borderRadius: 6, cursor: isSubmitting ? "wait" : "pointer",
            opacity: isSubmitting ? 0.65 : 1,
            transition: "background 140ms",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.blueDark; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.blue; }}
          >{isSubmitting ? "Signing in…" : "Sign in"}</button>
        </form>

        {/* OR divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <span style={{ fontSize: 13, color: C.secondary }}>OR</span>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>

        {/* Social buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Google */}
          <button style={{
            display: "flex", alignItems: "center", gap: 14,
            height: 48, padding: "0 18px",
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 6,
            fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500, color: C.ink,
            cursor: "pointer",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.subtle; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.white; }}
          >
            <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
              <path d="M17.1 9.2c0-.6-.05-1.18-.14-1.74H9v3.3h4.56a3.9 3.9 0 01-1.69 2.56v2.13h2.74C16.3 13.95 17.1 11.77 17.1 9.2z" fill="#4285F4"/>
              <path d="M9 18c2.29 0 4.21-.76 5.61-2.05l-2.74-2.13c-.76.51-1.73.81-2.87.81-2.2 0-4.07-1.49-4.73-3.49H1.45v2.2A8.99 8.99 0 009 18z" fill="#34A853"/>
              <path d="M4.27 11.14A5.4 5.4 0 013.98 9c0-.74.13-1.46.29-2.14V4.66H1.45A9 9 0 000 9c0 1.45.35 2.82.96 4.04l2.93-1.9z" fill="#FBBC05"/>
              <path d="M9 3.58c1.25 0 2.37.43 3.25 1.27l2.43-2.43A8.84 8.84 0 009 0 8.99 8.99 0 001.45 4.66l2.82 2.2C4.93 5.06 6.8 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {/* Facebook */}
          <button style={{
            display: "flex", alignItems: "center", gap: 14,
            height: 48, padding: "0 18px",
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 6,
            fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500, color: C.ink,
            cursor: "pointer",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.subtle; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.white; }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2">
              <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.234 2.686.234v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
            </svg>
            Continue with Facebook
          </button>
        </div>

        {/* Partner logos */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, margin: "28px 0 0" }}>
          {/* cruise about */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
            <span style={{ fontSize: 8, color: "#00AACC", fontWeight: 700, letterSpacing: "0.05em" }}>cruise</span>
            <span style={{ fontSize: 10, color: "#00AACC", fontWeight: 700 }}>about</span>
          </div>
          {/* Travel Marketplace text logo */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
            <span style={{ fontSize: 9, fontWeight: 900, color: C.red, letterSpacing: "0.04em" }}>FLIGHT</span>
            <span style={{ fontSize: 9, fontWeight: 900, color: C.red, letterSpacing: "0.04em" }}>CENTRE</span>
          </div>
          {/* Travel Associates */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#333", letterSpacing: "0.04em" }}>TRAVEL</span>
            <span style={{ fontSize: 7, fontWeight: 500, color: "#666", letterSpacing: "0.06em" }}>ASSOCIATES</span>
          </div>
          {/* World360 */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#1E3A8A" strokeWidth="1.5"/>
              <ellipse cx="12" cy="12" rx="4" ry="10" stroke="#1E3A8A" strokeWidth="1.5"/>
              <path d="M2 12h20" stroke="#1E3A8A" strokeWidth="1.5"/>
            </svg>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#1E3A8A", letterSpacing: "0.04em" }}>World360</span>
          </div>
        </div>

      </div>

      {/* Bottom legal */}
      <p style={{
        position: "fixed", bottom: 20,
        fontSize: 12, color: C.secondary, margin: 0, textAlign: "center",
      }}>
        By continuing you agree to our{" "}
        <span style={{ textDecoration: "underline", cursor: "pointer" }}>Terms</span> and{" "}
        <span style={{ textDecoration: "underline", cursor: "pointer" }}>Privacy Notice</span>.
      </p>
    </div>
  );
}

// ─── Marketplace Screen ────────────────────────────────────────────────────────
const MARKETPLACE_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function marketplacePrice(price: number | null) {
  if (price === null) return "Price on request";
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD", maximumFractionDigits: 0,
  }).format(price);
}

export function MarketplaceScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [packages, setPackages] = useState<MarketplacePackageSummary[]>([]);
  const [allPackages, setAllPackages] = useState<MarketplacePackageSummary[]>([]);
  const [liveResults, setLiveResults] = useState<MarketplacePackageSummary[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPackages = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMarketplacePackages(fetch, MARKETPLACE_API_URL);
      setPackages(data);
      setAllPackages(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load marketplace packages.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void fetchMarketplacePackages(fetch, MARKETPLACE_API_URL)
      .then((data) => {
        if (!active) return;
        setPackages(data);
        setAllPackages(data);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load marketplace packages.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchMarketplacePackages(fetch, MARKETPLACE_API_URL, query);
        if (!active) return;
        setLiveResults(data);
        setSuggestions(uniqueDestinationSuggestions(data));
        setShowSuggestions(true);
      } catch {
        if (active) setSuggestions([]);
      }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search]);

  const submitSearch = async (query = search) => {
    const trimmed = query.trim();
    setShowSuggestions(false);
    if (!trimmed) {
      setPackages(allPackages);
      return;
    }
    if (trimmed.length < 2) {
      setError("Enter at least 2 characters to search.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = query === search && liveResults.length ? liveResults
        : await searchMarketplacePackages(fetch, MARKETPLACE_API_URL, trimmed);
      setPackages(data);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Unable to search marketplace packages.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: C.white, minHeight: "100vh" }}>
      {/* Hero — red bg cuts through search card mid-point via absolute div */}
      <section style={{ position: "relative", overflow: "visible" }}>
        {/* Red background: ends 108px from section top + title height ≈ mid-card */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          height: "calc(52px + 56px + 28px + 28px + 60px + 20px)",
          background: "#d40119",
          zIndex: 0,
        }} />

        <div style={{
          position: "relative", zIndex: 1,
          width: "min(calc(100% - 48px), 1248px)",
          margin: "0 auto",
          padding: "52px 0 0",
        }}>
          {/* Page title */}
          <h1 style={{
            fontFamily: "var(--fc-font-display)", fontSize: 44, fontWeight: 800,
            lineHeight: "56px", letterSpacing: "-0.02em", color: C.white,
            margin: "0 0 28px",
          }}>
            Creator Trips
          </h1>

          {/* Search card */}
          <form onSubmit={(event) => { event.preventDefault(); void submitSearch(); }} style={{
            background: C.white,
            borderRadius: 20,
            padding: "28px 28px 0",
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
            marginBottom: 0,
          }}>
            {/* Row 1: destination input */}
            <div style={{
              display: "flex", alignItems: "center",
              background: "#EFEFEF",
              borderRadius: 999,
              padding: "0 24px",
              height: 60,
              marginBottom: 20,
              position: "relative",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#212121" style={{ flexShrink: 0, marginRight: 14, opacity: 0.55 }}>
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              <input
                value={search}
                onChange={(e) => {
                  const value = e.target.value;
                  setSearch(value);
                  setShowSuggestions(true);
                  setError("");
                  if (value.trim().length < 2) {
                    setSuggestions([]);
                    setLiveResults([]);
                    if (!value.trim()) setPackages(allPackages);
                  }
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="All destinations"
                role="combobox"
                aria-label="Search destinations"
                aria-autocomplete="list"
                aria-expanded={showSuggestions && suggestions.length > 0}
                aria-controls="marketplace-destination-suggestions"
                style={{
                  flex: 1, border: "none", outline: "none", background: "transparent",
                  fontFamily: "var(--fc-font-body)", fontSize: 17, color: C.ink,
                }}
              />
              {showSuggestions && search.trim().length >= 2 && (
                <div id="marketplace-destination-suggestions" role="listbox" style={{
                  position: "absolute", zIndex: 10, top: 66, left: 0, right: 0,
                  background: C.white, border: `1px solid ${C.border}`,
                  borderRadius: C.radiusMd, boxShadow: C.shadowRaised, overflow: "hidden",
                }}>
                  {suggestions.length > 0 ? suggestions.map((destination) => (
                    <button
                      key={destination}
                      type="button"
                      role="option"
                      aria-selected="false"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { setSearch(destination); void submitSearch(destination); }}
                      style={{
                        width: "100%", padding: "12px 18px", border: "none",
                        borderBottom: `1px solid ${C.border}`, background: C.white,
                        textAlign: "left", fontFamily: "var(--fc-font-body)",
                        fontSize: 15, color: C.ink, cursor: "pointer",
                      }}
                    >
                      {destination}
                    </button>
                  )) : (
                    <p style={{ margin: 0, padding: "12px 18px", color: C.secondary, fontSize: 14 }}>
                      No matching destinations
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Row 2: filters + search button */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              paddingBottom: 24,
            }}>
              <div style={{ display: "flex", gap: 4 }}>
                {["All departure dates", "All trip types"].map((label) => (
                  <button key={label} type="button" style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: "none", border: "none", cursor: "pointer",
                    fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 500,
                    color: C.ink, padding: "8px 12px",
                    textDecoration: "underline", textUnderlineOffset: 3,
                  }}>
                    {label}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                ))}
              </div>
              <button
                type="submit"
                onMouseEnter={(e) => (e.currentTarget.style.background = C.blueDark)}
                onMouseLeave={(e) => (e.currentTarget.style.background = C.blue)}
                style={{
                  background: C.blue, color: C.white, border: "none",
                  borderRadius: 10, padding: "14px 32px",
                  fontFamily: "var(--fc-font-body)", fontSize: 16, fontWeight: 500,
                  cursor: "pointer", transition: "background 140ms", whiteSpace: "nowrap",
                }}>
                Search trips
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Body */}
      <div style={{ width: "min(calc(100% - 48px), 1248px)", margin: "0 auto", padding: "56px 0 112px" }}>

        {/* Section heading */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{
            fontFamily: "var(--fc-font-display)", fontSize: 36, fontWeight: 800,
            color: C.ink, margin: "0 0 10px", lineHeight: "44px", letterSpacing: "-0.02em",
          }}>
            Trips curated by people who&apos;ve{" "}
            <span style={{ color: C.blue }}>actually been there.</span>
          </h2>
          <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 18, color: C.secondary, margin: 0, lineHeight: "28px", fontWeight: 400 }}>
            Real itineraries from creators who live to explore — verified by Travel Marketplace
          </p>
        </div>

        {/* 4-col tour card grid */}
        {loading ? (
          <p role="status" style={{ color: C.secondary, padding: "48px 0", textAlign: "center" }}>Loading trips…</p>
        ) : error ? (
          <div role="alert" style={{ textAlign: "center", padding: "48px 0" }}>
            <p style={{ color: C.red }}>{error}</p>
            <BtnSecondary onClick={() => void loadPackages()}>Try again</BtnSecondary>
          </div>
        ) : packages.length === 0 ? (
          <p style={{ color: C.secondary, padding: "48px 0", textAlign: "center" }}>No trips match your search.</p>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20, marginBottom: 56 }}>
          {packages.map((card) => {
            const destination = [card.destination_city, card.destination_country].filter(Boolean).join(", ");
            const creatorName = card.influencer?.display_name || "Marketplace creator";
            const openTrip = () => router.push(`/marketplace/packages/${card.package_id}`);
            return (
            <article
              key={card.package_id}
              role="link"
              tabIndex={0}
              onClick={openTrip}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTrip(); } }}
              style={{
                borderRadius: 14, overflow: "hidden",
                border: `1px solid ${C.border}`,
                background: C.white,
                boxShadow: C.shadowCard,
                display: "flex", flexDirection: "column",
                cursor: "pointer",
              }}
            >
              {/* Image */}
              <div style={{ position: "relative", aspectRatio: "3/2", overflow: "hidden" }}>
                <img src={card.cover_image_url || IMG.hero} alt={card.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>

              {/* Body */}
              <div style={{ padding: "18px 18px 20px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0 }}>
                  {card.duration_days ? `${card.duration_days} days` : "Duration on request"} · {destination || "Destination coming soon"}
                </p>
                <p style={{
                  fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 600,
                  color: C.ink, margin: 0, lineHeight: "22px",
                  display: "-webkit-box", WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {card.title}
                </p>

                {/* Creator info */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 0", borderTop: `1px solid ${C.border}`, marginTop: 6,
                }}>
                  <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: "50%", background: C.subtle, display: "grid", placeItems: "center", fontWeight: 700 }}>{creatorName.charAt(0).toUpperCase()}</span>
                  <div>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 600, color: C.ink, margin: 0, lineHeight: "20px" }}>{creatorName}</p>
                    {card.influencer?.instagram_handle && <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0, lineHeight: "18px" }}>{card.influencer.instagram_handle}</p>}
                  </div>
                  <span style={{
                    marginLeft: "auto", background: "#EEF5FF", color: C.blue,
                    fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 700,
                    padding: "4px 10px", borderRadius: 999, letterSpacing: "0.05em", flexShrink: 0,
                  }}>CREATOR</span>
                </div>

                <div style={{ paddingTop: 6 }}>
                  <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 12, color: C.secondary, margin: "0 0 3px" }}>From per person</p>
                  <p style={{ fontFamily: "var(--fc-font-display)", fontSize: 24, fontWeight: 700, color: C.ink, margin: "0 0 14px", letterSpacing: "-0.01em" }}>{marketplacePrice(card.base_price_aud)}</p>
                  <BtnPrimary full onClick={openTrip}>View trip</BtnPrimary>
                </div>
              </div>
            </article>
          )})}
        </div>
        )}
      </div>

      {/* Creator Program Banner */}
      <div style={{ background: "#F0F4FF", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{
          width: "min(calc(100% - 48px), 1248px)", margin: "0 auto",
          display: "flex", alignItems: "stretch", gap: 0, minHeight: 220,
        }}>
          {/* Text side */}
          <div style={{ flex: 1, padding: "48px 48px 48px 0", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <p style={{
              fontSize: 16, fontWeight: 600, color: C.red,
              letterSpacing: "0.1em", textTransform: "uppercase",
              margin: "0 0 12px", fontFamily: "var(--fc-font-body)",
            }}>For Creators</p>
            <h2 style={{
              fontFamily: "var(--fc-font-body)", fontSize: 32, fontWeight: 700,
              color: C.ink, lineHeight: "40px", margin: "0 0 14px", letterSpacing: "-0.01em",
            }}>Turn your ideas into trips people can book.</h2>
            <p style={{
              fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.secondary,
              lineHeight: "24px", margin: "0 0 28px", maxWidth: 480,
            }}>
              Partner with Travel Marketplace to create and share trips your community can experience—and earn incentives based on eligible bookings.
            </p>
            <div>
              <button style={{
                fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 600,
                color: C.white, background: C.blue,
                border: "none",
                borderRadius: 8, padding: "12px 24px",
                cursor: "pointer", transition: "background 140ms",
                display: "inline-flex", alignItems: "center", gap: 8,
                marginBottom: 12,
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.blueDark; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.blue; }}
              >
                Apply to join as a creator
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
              <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.disabled, margin: "10px 0 0" }}>
                Applications are reviewed before publishing access is granted.
              </p>
            </div>
          </div>

          {/* Image side */}
          <div style={{ width: 480, flexShrink: 0, overflow: "hidden" }}>
            <img
              src={creatorBannerImg}
              alt="Travel creator filming with smartphone gimbal"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ background: C.ink }}>
        <div style={{
          maxWidth: 1280, margin: "0 auto", padding: "56px 64px 40px",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div style={{ maxWidth: 280 }}>
            <p style={{
              fontFamily: "var(--fc-font-display)", fontSize: 18, fontWeight: 800,
              textTransform: "uppercase", color: C.white, margin: "0 0 12px",
            }}>Travel Marketplace</p>
            <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, lineHeight: "20px", color: "rgba(255,255,255,0.5)", margin: 0 }}>
              Australia&apos;s favourite travel retailer since 1981.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "0 64px" }}>
            {[
              { heading: "Explore", links: ["Destinations", "Deals", "Holiday packages", "Flights"] },
              { heading: "Company", links: ["About us", "Careers", "Press", "Contact"] },
            ].map(({ heading, links }) => (
              <div key={heading}>
                <p style={{
                  fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 500,
                  color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase",
                  margin: "0 0 16px",
                }}>{heading}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {links.map((l) => (
                    <a key={l} href="#" onClick={(e) => e.preventDefault()} style={{
                      fontFamily: "var(--fc-font-body)", fontSize: 14, lineHeight: "20px",
                      color: "rgba(255,255,255,0.6)", textDecoration: "none",
                    }}>{l}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", maxWidth: 1280, margin: "0 auto", padding: "24px 64px" }}>
          <p style={{
            fontFamily: "var(--fc-font-body)", fontSize: 12, lineHeight: "16px",
            color: "rgba(255,255,255,0.35)", margin: 0,
          }}>
            © 2026 Travel Marketplace Travel Group Limited. All rights reserved. Prices are per person, land only, subject to availability.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Dashboard Screen ──────────────────────────────────────────────────────────
export function DashboardScreen({ onNav: _onNav }: { onNav: (s: Screen) => void }) {
  const router = useRouter();
  const [packages, setPackages] = useState<CreatorPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeTab, setActiveTab] = useState("All");
  const [hovRow, setHovRow] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const tabs = ["All", "Approved", "Under review", "Drafts"];

  useEffect(() => {
    if (!pendingDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingDelete]);

  const confirmDeletePackage = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        router.replace("/login");
        return;
      }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      await deletePackage(fetch, apiUrl, accessToken, pendingDelete.id);
      setPendingDelete(null);
      await loadPackages();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete this package.";
      setDeleteError(message);
      if (message.includes("sign in again")) router.replace("/login");
    } finally {
      setIsDeleting(false);
    }
  };

  const loadPackages = async () => {
    setIsLoading(true);
    setLoadError("");
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      setPackages(await fetchOwnPackages(fetch, apiUrl, accessToken));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load your packages.";
      setLoadError(message);
      if (message.includes("sign in again")) router.replace("/login");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(async ({ data }) => {
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        router.replace("/login");
        return;
      }
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const result = await fetchOwnPackages(fetch, apiUrl, accessToken);
        if (!cancelled) setPackages(result);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unable to load your packages.";
        setLoadError(message);
        if (message.includes("sign in again")) router.replace("/login");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [router]);

  const dashboardPackages = packages.map(formatCreatorPackage);
  const normalizedSearch = searchQ.trim().toLowerCase();
  const filtered = dashboardPackages.filter((pkg) => {
    const matchesTab = activeTab === "All"
      || pkg.status === activeTab
      || (activeTab === "Drafts" && pkg.status === "Draft");
    const matchesSearch = !normalizedSearch
      || pkg.name.toLowerCase().includes(normalizedSearch)
      || pkg.destination.toLowerCase().includes(normalizedSearch);
    return matchesTab && matchesSearch;
  });

  const stats = [
    { label: "Packages", value: String(packages.length), sub: "All your packages" },
    { label: "Live", value: String(packages.filter((p) => p.status === "live").length), sub: "Published & bookable" },
    { label: "Approved", value: String(packages.filter((p) => p.status === "approved").length), sub: "Creator preview available" },
    { label: "Drafts", value: String(packages.filter((p) => p.status === "draft").length), sub: "Still in progress" },
  ];

  const cols = {
    grid: "minmax(0,1.8fr) minmax(140px,1fr) 100px 120px 140px 200px",
    gap: 24,
    headers: [
      { h: "Package",        align: "left"  },
      { h: "Destination",    align: "left"  },
      { h: "Duration",       align: "right" },
      { h: "Price",          align: "right" },
      { h: "Status",         align: "center" },
      { h: "Actions",        align: dashboardActionAlignment.header },
    ],
  };

  return (
    <div style={{ background: C.subtle, minHeight: "100vh" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 40px 80px" }}>

        {/* Page heading */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontFamily: "var(--fc-font-body)", fontSize: 24, fontWeight: 700, lineHeight: "32px", color: C.ink, margin: "0 0 4px" }}>
              Creator dashboard
            </h1>
            <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0 }}>
              Manage your packages, bookings and earnings.
            </p>
          </div>
          <BtnPrimary onClick={() => _onNav("builder")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Create package
          </BtnPrimary>
        </div>

        {/* Stats cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
          {stats.map(({ label, value, sub }) => (
            <div key={label} style={{
              background: C.white,
              borderTop: `1px solid ${C.border}`,
              borderRight: `1px solid ${C.border}`,
              borderBottom: `1px solid ${C.border}`,
              borderLeft: `1px solid ${C.border}`,
              borderRadius: C.radiusMd,
              padding: "24px 24px 20px",
              boxShadow: C.shadowCard,
            }}>
              <p style={{
                fontFamily: "var(--fc-font-body)", fontSize: 13, fontWeight: 400,
                letterSpacing: "0.05em", textTransform: "uppercase",
                color: C.secondary, margin: "0 0 10px",
              }}>{label}</p>
              <p style={{
                fontFamily: "var(--fc-font-body)", fontSize: 38, fontWeight: 700,
                lineHeight: 1, letterSpacing: "-0.02em",
                color: C.ink, margin: "0 0 8px",
                fontVariantNumeric: "tabular-nums",
              }}>{value}</p>
              <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0 }}>{sub}</p>
            </div>
          ))}
        </div>

        {/* Packages table */}
        <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>

          {/* Table toolbar */}
          {/* Toolbar: search + filter tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 28px", borderBottom: `1px solid ${C.border}` }}>
            {/* Search input */}
            <div style={{ position: "relative", width: 520, flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.secondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search packages..."
                style={{
                  width: "100%", boxSizing: "border-box",
                  height: 42, paddingLeft: 38, paddingRight: 14,
                  fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.ink,
                  background: C.white, border: `1px solid ${C.border}`,
                  borderRadius: 6, outline: "none",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#9E9E9E"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
              />
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 4 }}>
              {tabs.map((t) => {
                const on = activeTab === t;
                return (
                  <button key={t} onClick={() => setActiveTab(t)} style={{
                    fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: on ? 600 : 400,
                    color: on ? C.white : C.secondary,
                    background: on ? C.ink : "none",
                    border: on ? "none" : `1px solid transparent`,
                    borderRadius: 6, padding: "6px 14px",
                    cursor: "pointer", transition: "all 140ms",
                  }}
                    onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = C.subtle; }}
                    onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "none"; }}
                  >{t}</button>
                );
              })}
            </div>
          </div>

          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: cols.grid, columnGap: cols.gap, padding: "14px 28px", background: "#FAFAFA", borderBottom: `1px solid ${C.border}` }}>
            {cols.headers.map(({ h, align }) => (
              <p key={h} style={{
                fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 400,
                color: C.secondary, margin: 0,
                textAlign: align as "left" | "center" | "right",
              }}>{h}</p>
            ))}
          </div>

          {isLoading ? (
            <p role="status" style={{ margin: 0, padding: "36px 28px", color: C.secondary, textAlign: "center" }}>
              Loading your packages…
            </p>
          ) : loadError ? (
            <div role="alert" style={{ padding: "32px 28px", textAlign: "center" }}>
              <p style={{ margin: "0 0 14px", color: "#B42318" }}>{loadError}</p>
              <BtnSecondary onClick={() => void loadPackages()}>Try again</BtnSecondary>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "44px 28px", textAlign: "center" }}>
              <p style={{ margin: "0 0 6px", color: C.ink, fontWeight: 600 }}>
                {packages.length === 0 ? "No packages yet" : "No packages match your filters"}
              </p>
              <p style={{ margin: 0, color: C.secondary, fontSize: 14 }}>
                {packages.length === 0 ? "Create your first package to get started." : "Try a different search or status."}
              </p>
            </div>
          ) : null}

          {/* Rows */}
          {filtered.map((pkg, i) => {
            const hov = hovRow === pkg.name;
            const packageHref = creatorPackageRoute(pkg.id, pkg.statusKey);
            const statusStyle = pkg.statusKey === "live" || pkg.statusKey === "approved"
              ? { color: C.success, background: C.successBg }
              : pkg.statusKey === "pending_review"
                ? { color: C.warning, background: C.warningBg }
                : { color: C.secondary, background: C.subtle };
            return (
              <div key={pkg.id}
                style={{
                  display: "grid", gridTemplateColumns: cols.grid, columnGap: cols.gap,
                  padding: "22px 28px", alignItems: "center",
                  borderBottom: i < filtered.length - 1 ? `1px solid #F0F0F0` : "none",
                  background: hov ? "#FAFAFA" : "transparent",
                  transition: "background 120ms",
                }}
                onMouseEnter={() => setHovRow(pkg.name)}
                onMouseLeave={() => setHovRow(null)}
              >
                {/* Package name */}
                <div style={{ minWidth: 0 }}>
                  <Link className="dashboard-package-link" href={packageHref}>
                    <span>{pkg.name}</span>
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke={C.blue} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </Link>
                </div>

                <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0 }}>
                  {pkg.destination}
                </p>

                <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.ink, margin: 0, textAlign: "right" }}>
                  {pkg.duration}
                </p>

                <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.ink, margin: 0, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {pkg.price}
                </p>

                {/* Status badge */}
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    fontFamily: "var(--fc-font-body)", fontSize: 13, fontWeight: 500,
                    color: statusStyle.color, background: statusStyle.background,
                    padding: "5px 12px", borderRadius: C.radiusPill,
                    display: "inline-block", whiteSpace: "nowrap",
                  }}>{pkg.status}</span>
                </div>

                {/* Row action */}
                <div style={{ textAlign: dashboardActionAlignment.buttons, display: "flex", justifyContent: dashboardActionAlignment.buttons, gap: 8 }}>
                  <Link className="dashboard-row-action" href={packageHref} aria-label={`${pkg.rowAction} ${pkg.name}`} title={pkg.rowAction}>
                    {pkg.rowAction === "Edit"
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>}
                  </Link>
                  {pkg.statusKey === "draft" && (
                    <button className="dashboard-row-action dashboard-row-action-delete"
                      aria-label={`Delete ${pkg.name}`} title="Delete"
                      onClick={() => { setDeleteError(""); setPendingDelete({ id: pkg.id, name: pkg.name }); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {pendingDelete && (
        <div className="delete-day-backdrop" role="presentation" onMouseDown={() => !isDeleting && setPendingDelete(null)}>
          <section
            className="delete-day-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-package-title"
            aria-describedby="delete-package-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-package-title">Delete &ldquo;{pendingDelete.name}&rdquo;?</h2>
            <p id="delete-package-description">This draft package will be permanently deleted. This cannot be undone.</p>
            {deleteError && <p role="alert" style={{ color: "#B42318", margin: "0 0 12px", fontSize: 14 }}>{deleteError}</p>}
            <div className="delete-day-actions">
              <button className="quiet-button" autoFocus disabled={isDeleting} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="confirm-delete-button" disabled={isDeleting} onClick={() => void confirmDeletePackage()}>
                {isDeleting ? "Deleting…" : "Delete package"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ─── Creator header ───────────────────────────────────────────────────────────
export function CreatorNav({ onNav }: { onNav: (s: Screen) => void }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [creatorProfile, setCreatorProfile] = useState({
    displayName: "Creator",
    initials: "C",
    avatarUrl: null as string | null,
  });
  const CONTAINER = "min(calc(100% - 80px), 1200px)";

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name,avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setCreatorProfile(resolveCreatorProfile(profile, user.user_metadata, user.email ?? ""));
      }
    });
    return () => { cancelled = true; };
  }, []);

  const handleLogOut = async () => {
    await supabase.auth.signOut();
    setProfileOpen(false);
    onNav("login");
  };

  return (
    <div style={{ position: "sticky", top: 0, zIndex: 100 }}>

      {/* ── Red global header: logo + help + profile ── */}
      <div style={{ width: "100%", height: 64, background: "#d40119", display: "flex", alignItems: "center" }}>
        <div style={{ width: CONTAINER, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => onNav("marketplace")} style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
            }}>
              <MarketplaceBrandLogo />
            </button>
            {/* Creator Hub badge */}
            <span style={{
              fontFamily: "var(--fc-font-body)", fontSize: 11, fontWeight: 600,
              color: "rgba(255,255,255,0.7)", letterSpacing: "0.08em", textTransform: "uppercase",
              borderLeft: "1px solid rgba(255,255,255,0.25)", paddingLeft: 16,
            }}>Creator Hub</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <MarketplaceControl>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Help
            </MarketplaceControl>

            {/* Profile pill */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                aria-expanded={profileOpen}
                aria-label={`Open profile menu for ${creatorProfile.displayName}`}
                style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                height: 40, padding: "0 12px 0 4px",
                border: 0, borderRadius: 9999,
                background: "#fff", color: "#212121",
                fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500,
                cursor: "pointer", flexShrink: 0,
              }}>
                {creatorProfile.avatarUrl ? (
                  <img
                    src={creatorProfile.avatarUrl}
                    alt=""
                    style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", margin: "0 2px" }}
                  />
                ) : (
                  <span aria-hidden="true" style={{
                    width: 28, height: 28, borderRadius: "50%", margin: "0 2px",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    background: C.subtle, color: C.ink, fontSize: 12, fontWeight: 700,
                  }}>
                    {creatorProfile.initials}
                  </span>
                )}
                <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {creatorProfile.displayName}
                </span>
                <Chevron />
              </button>

              {profileOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0,
                  background: C.white, borderRadius: 12,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                  border: `1px solid ${C.border}`,
                  overflow: "hidden", minWidth: 200, zIndex: 200,
                }}>
                  {[
                    { label: "View Travel Marketplace", action: () => { onNav("marketplace"); setProfileOpen(false); } },
                    { label: "Account settings",   action: () => setProfileOpen(false) },
                    { label: "Log out",            action: handleLogOut },
                  ].map(({ label, action }) => (
                    <button key={label} onClick={action} style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "13px 18px",
                      fontFamily: "var(--fc-font-body)", fontSize: 14,
                      fontWeight: label === "Log out" ? 500 : 400,
                      color: label === "Log out" ? "#C8001A" : C.ink,
                      background: "none", border: "none", cursor: "pointer",
                      borderBottom: label !== "Log out" ? `1px solid ${C.border}` : "none",
                      transition: "background 120ms",
                    }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = C.subtle)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >{label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function CreatorCreationSubnav({ confirmBeforeLeaving = false, backHref, backLabel, icon = "chevron" }: { confirmBeforeLeaving?: boolean; backHref?: string; backLabel?: string; icon?: "chevron" | "x" }) {
  return (
    <nav
      aria-label="Package creation navigation"
      style={{
        position: "sticky", top: 0, zIndex: 90,
        height: 64, flexShrink: 0,
        background: C.white, borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div style={{ width: "min(calc(100% - 80px), 1200px)", height: "100%", margin: "0 auto", display: "flex", alignItems: "center" }}>
        <Link
          href={backHref ?? creatorDashboardBackLink.href}
          onClick={(event) => {
            if (confirmBeforeLeaving && !window.confirm("Leave without finishing this package? Your progress will be lost.")) {
              event.preventDefault();
            }
          }}
          style={{
            width: "fit-content", minHeight: 48, display: "inline-flex", alignItems: "center", gap: 8,
            fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 500,
            color: C.ink, textDecoration: "none",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icon === "x" ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="m15 18-6-6 6-6" />}
          </svg>
          {backLabel ?? creatorDashboardBackLink.label}
        </Link>
      </div>
    </nav>
  );
}

// ─── Builder Screen ────────────────────────────────────────────────────────────
const BUILDER_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const NEW_PACKAGE_DRAFT = {
  title: "",
  description: "",
  destination_country: "",
  destination_city: "",
  duration_days: "3",
  base_price_aud: "",
  max_group_size: "",
};

type NewPackageDraft = typeof NEW_PACKAGE_DRAFT;

export function applyCatalogDestination(
  draft: NewPackageDraft,
  destination: { city: string; country: string } | null,
): NewPackageDraft {
  return {
    ...draft,
    destination_country: destination?.country ?? "",
    destination_city: destination?.city ?? "",
  };
}

export function isNewPackageDraftValid(draft: NewPackageDraft) {
  return Boolean(
    draft.title.trim()
    && draft.description.trim()
    && draft.destination_country.trim()
    && draft.destination_city.trim()
    && Number(draft.duration_days) >= 1
    && draft.base_price_aud.trim() !== ""
    && Number(draft.base_price_aud) >= 0,
  );
}

export function isManualPackageStepValid(draft: NewPackageDraft, step: number) {
  if (step === 0) return Boolean(draft.title.trim() && draft.description.trim());
  if (step === 1) return Boolean(draft.destination_country.trim() && draft.destination_city.trim());
  if (step === 2) {
    return Boolean(
      Number(draft.duration_days) >= 1
      && draft.base_price_aud.trim() !== ""
      && Number(draft.base_price_aud) >= 0,
    );
  }
  return isNewPackageDraftValid(draft);
}

export function BuilderScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [hovScratch, setHovScratch] = useState(false);

  const steps = [
    { n: 1, label: "Choose destination & travel style" },
    { n: 2, label: "Set duration & season" },
    { n: 3, label: "AI drafts your itinerary" },
    { n: 4, label: "Review, customise & submit for review" },
  ];

  return (
    <div className="ai-wizard-screen" style={{ minHeight: "calc(100vh - 64px)", background: C.subtle }}>
      <CreatorCreationSubnav />

      {/* Content */}
      <div style={{ width: "min(calc(100% - 48px), 800px)", margin: "0 auto", padding: "28px 24px 48px" }}>

          {/* Heading */}
          <div style={{ marginBottom: 30 }}>
            <p style={{
              fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 700,
              color: C.red, letterSpacing: "0.1em", textTransform: "uppercase",
              margin: "0 0 10px",
            }}>New Package</p>
            <h1 style={{
              fontFamily: "var(--fc-font-body)", fontSize: 32, fontWeight: 700,
              color: C.ink, lineHeight: "40px", letterSpacing: "-0.02em",
              margin: "0 0 8px",
            }}>Travel Creator Itinerary Builder</h1>
            <p style={{
              fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.secondary,
              lineHeight: "22px", margin: 0,
            }}>
              Turn your travel experiences into bookable packages
            </p>
          </div>

          {/* Start with AI card */}
          <div style={{
            background: C.white,
            border: `2px solid ${C.ink}`,
            borderRadius: 14,
            padding: "24px 32px 28px",
            marginBottom: 12,
            position: "relative",
            boxShadow: C.shadowRaised,
          }}>
            <span style={{
              position: "absolute", top: 16, right: 16,
              background: C.red, color: C.white,
              fontFamily: "var(--fc-font-body)", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "4px 10px", borderRadius: 5,
            }}>Recommended</span>

            {/* AI icon + title */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                </svg>
              </div>
              <div>
                <h2 style={{
                  fontFamily: "var(--fc-font-body)", fontSize: 22, fontWeight: 700,
                  color: C.ink, margin: 0, lineHeight: 1.2,
                }}>Start with AI</h2>
                <p style={{
                  fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary,
                  margin: "3px 0 0",
                }}>Generate a complete itinerary instantly</p>
              </div>
            </div>

            {/* Steps — vertical */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 20 }}>
              {steps.map((step, i) => (
                <div key={step.n} style={{ display: "flex", alignItems: "flex-start", gap: 14, position: "relative" }}>
                  {i < steps.length - 1 && (
                    <div style={{ position: "absolute", left: 16, top: 34, width: 2, height: 20, background: C.border }} />
                  )}
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{ fontFamily: "var(--fc-font-body)", fontSize: 13, fontWeight: 700, color: C.white }}>{step.n}</span>
                  </div>
                  <p style={{
                    fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500,
                    color: C.ink, margin: "6px 0", lineHeight: "20px",
                    paddingBottom: i < steps.length - 1 ? 20 : 0,
                  }}>{step.label}</p>
                </div>
              ))}
            </div>

            {/* CTA */}
            <button onClick={() => onNav("ai-wizard")} style={{
              width: "100%", height: 46,
              background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
              color: C.white, border: "none", borderRadius: 8,
              fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              transition: "opacity 140ms",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.88"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/>
              </svg>
              Generate with AI
            </button>
          </div>

          {/* Build from scratch */}
          <button
            onClick={() => onNav("manual-builder")}
            onMouseEnter={() => setHovScratch(true)}
            onMouseLeave={() => setHovScratch(false)}
            style={{
              width: "100%", background: C.white,
              border: `1px solid ${hovScratch ? "#9E9E9E" : C.border}`,
              borderRadius: 10, padding: "16px 24px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              cursor: "pointer", transition: "border-color 140ms, box-shadow 140ms",
              boxShadow: hovScratch ? C.shadowCard : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                background: C.subtle, border: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.secondary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </div>
              <div>
                <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 600, color: C.ink, margin: "0 0 2px" }}>Build from Scratch</p>
                <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 13, color: C.secondary, margin: 0 }}>Manual control over every detail</p>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.secondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ flexShrink: 0, transition: "transform 140ms", transform: hovScratch ? "translateX(4px)" : "none" }}>
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>

      </div>

    </div>
  );
}

// ─── AI Wizard Screen ──────────────────────────────────────────────────────────
type WizardStepKind = "destination" | "style" | "duration" | "season";
const AI_STEP_KINDS: WizardStepKind[] = ["destination", "style", "duration", "season"];
// Manual builds skip the duration step (the creator sets days in the editor)
// and skip AI generation, so there's nothing to fake-load either.
const MANUAL_STEP_KINDS: WizardStepKind[] = ["destination", "style", "season"];
const STEP_LABEL_BY_KIND: Record<WizardStepKind, string> = {
  destination: "Destination", style: "Travel style", duration: "Duration", season: "Season",
};

const SEASON_CARDS = [
  { id: "spring", label: "Spring", desc: "Blooming scenery and fresh, vibrant energy", tags: ["Mild weather", "Fresh blooms", "Garden walks"], img: "https://images.unsplash.com/photo-1622285422722-b1b3eb36c728?w=600&h=320&fit=crop" },
  { id: "summer", label: "Summer", desc: "Warm days and endless outdoor adventures", tags: ["Long days", "Outdoor fun", "Lively atmosphere"], img: "https://images.unsplash.com/photo-1461937995729-a2e442122d18?w=600&h=320&fit=crop" },
  { id: "autumn", label: "Autumn", desc: "Colorful foliage and cozy moments", tags: ["Foliage tours", "Crisp air", "Harvest season"], img: "https://images.unsplash.com/photo-1542574929305-245cb48f9c87?w=600&h=320&fit=crop" },
  { id: "winter", label: "Winter", desc: "Cool weather and relaxed experiences", tags: ["Winter scenery", "Cosy stays", "Fewer crowds"], img: "https://images.unsplash.com/photo-1551927411-95e412943b58?w=600&h=320&fit=crop" },
] as const;

type DestinationOption = { city: string; country: string; avgRating: number };

export function destinationSelection(destination: Pick<DestinationOption, "city" | "country">) {
  const name = `${destination.city}, ${destination.country}`;
  return { name, search: name };
}

export function destinationMatchesSearch(
  destination: Pick<DestinationOption, "city" | "country">,
  query: string,
) {
  return `${destination.city}, ${destination.country}`.toLowerCase().includes(query.trim().toLowerCase());
}

export function destinationOptionsForSearch(
  destinations: DestinationOption[],
  recommended: DestinationOption[],
  query: string,
) {
  return query
    ? destinations.filter((destination) => destinationMatchesSearch(destination, query))
    : recommended;
}

// A destination needs at least this many catalog activities before it's
// eligible for "Recommended" — otherwise a high average rating could be an
// artifact of two or three activities, not a real signal the creator can build on.
const MIN_ACTIVITIES_FOR_RECOMMENDATION = 10;

function useDestinationCatalog() {
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [recommended, setRecommended] = useState<DestinationOption[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const places = new Map<string, { city: string; country: string }>();
      const activityCounts = new Map<string, number>();
      const ratingTotals = new Map<string, { sum: number; count: number }>();
      const pageSize = 1000;
      for (let offset = 0; offset < 10_000; offset += pageSize) {
        const { data, error } = await supabase
          .from("activities")
          .select("city,country,rating")
          .order("city", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error || !data || cancelled) break;
        for (const row of data) {
          const key = `${row.city}|${row.country}`;
          if (!places.has(key)) places.set(key, { city: row.city, country: row.country });
          activityCounts.set(key, (activityCounts.get(key) ?? 0) + 1);
          if (row.rating != null) {
            const totals = ratingTotals.get(key) ?? { sum: 0, count: 0 };
            totals.sum += row.rating;
            totals.count += 1;
            ratingTotals.set(key, totals);
          }
        }
        if (data.length < pageSize) break;
      }
      if (cancelled) return;
      const found: DestinationOption[] = [...places.entries()].map(([key, place]) => {
        const totals = ratingTotals.get(key);
        return { ...place, avgRating: totals && totals.count > 0 ? totals.sum / totals.count : 0 };
      });
      found.sort((a, b) => a.city.localeCompare(b.city));
      setDestinations(found);
      setRecommended(
        found
          .filter((destination) => (activityCounts.get(`${destination.city}|${destination.country}`) ?? 0) >= MIN_ACTIVITIES_FOR_RECOMMENDATION)
          .sort((a, b) => b.avgRating - a.avgRating)
          .slice(0, 6),
      );
      setDestinationsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { destinations, recommended, destinationsLoading };
}

function DestinationPicker({
  idPrefix,
  search,
  selected,
  destinations,
  recommended,
  loading,
  onSearchChange,
  onSelect,
}: {
  idPrefix: string;
  search: string;
  selected: string | null;
  destinations: DestinationOption[];
  recommended: DestinationOption[];
  loading: boolean;
  onSearchChange: (value: string) => void;
  onSelect: (destination: DestinationOption) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [recommendationInfoOpen, setRecommendationInfoOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const filtered = destinations.filter((destination) => destinationMatchesSearch(destination, search));
  const visible = destinationOptionsForSearch(destinations, recommended, search);
  const listboxId = `${idPrefix}-destination-listbox`;
  const tooltipId = `${idPrefix}-destination-recommendation-tooltip`;

  return (
    <div>
      <label style={{ display: "block", margin: "0 0 24px" }}>
        <span style={{ display: "block", fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.secondary, marginBottom: 10 }}>
          Search destinations
        </span>
        <div style={{ position: "relative" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.secondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            value={search}
            onChange={(event) => { onSearchChange(event.target.value); setDropdownOpen(true); }}
            placeholder="Search by city or country…"
            role="combobox"
            aria-expanded={dropdownOpen}
            aria-autocomplete="list"
            aria-controls={listboxId}
            style={{
              width: "100%", boxSizing: "border-box", height: 52,
              paddingLeft: 48, paddingRight: search ? 48 : 16,
              fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.ink,
              border: `1.5px solid ${C.border}`, borderRadius: 12, outline: "none",
              background: C.white, boxShadow: C.shadowCard,
              transition: "border-color 140ms, box-shadow 140ms",
            }}
            onFocus={(event) => { event.currentTarget.style.borderColor = C.blue; event.currentTarget.style.boxShadow = `0 0 0 3px ${C.focusRing}`; setDropdownOpen(true); }}
            onBlur={(event) => { event.currentTarget.style.borderColor = C.border; event.currentTarget.style.boxShadow = C.shadowCard; setDropdownOpen(false); }}
            onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.blur(); }}
          />
          {search && (
            <button type="button" aria-label="Clear destination search" onClick={() => onSearchChange("")} style={{ position: "absolute", right: 6, top: 4, width: 44, height: 44, display: "grid", placeItems: "center", border: 0, background: "transparent", color: C.secondary, cursor: "pointer" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          )}
          {dropdownOpen && (
            <div id={listboxId} role="listbox" aria-label="City or country results" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 20, maxHeight: 320, overflowY: "auto", background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: C.shadowRaised }}>
              {loading && <p style={{ margin: 0, padding: "14px 16px", fontFamily: "var(--fc-font-body)", fontSize: 13, color: C.secondary }}>Loading destinations…</p>}
              {!loading && filtered.length === 0 && <p style={{ margin: 0, padding: "14px 16px", fontFamily: "var(--fc-font-body)", fontSize: 13, color: C.secondary }}>No destinations found{search ? ` for “${search}”` : ""}.</p>}
              {filtered.map((destination) => {
                const name = `${destination.city}, ${destination.country}`;
                return (
                  <button key={name} type="button" role="option" aria-selected={selected === name} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHovered(name)} onMouseLeave={() => setHovered(null)} onClick={() => { onSelect(destination); setDropdownOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", border: 0, borderBottom: `1px solid ${C.border}`, background: destinationOptionBackground(selected === name, hovered === name), cursor: "pointer", textAlign: "left", transition: "background-color 120ms ease" }}>
                    <span><span style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 600, color: selected === name ? C.blue : C.ink }}>{destination.city}</span><span style={{ fontFamily: "var(--fc-font-body)", fontSize: 13, color: C.secondary }}>, {destination.country}</span></span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <p style={{ margin: "8px 2px 0", fontFamily: "var(--fc-font-body)", fontSize: 12.5, lineHeight: "17px", color: C.secondary }}>
          Some destinations are currently unavailable due to safety considerations.
        </p>
      </label>

      <div style={{ minHeight: 32, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        <div style={{ fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.secondary, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          {search ? `${filtered.length} matching destinations` : "Recommended destinations"}
          {!search && (
            <span onMouseEnter={() => setRecommendationInfoOpen((open) => nextRecommendationInfoOpen(open, "focus"))} onMouseLeave={() => setRecommendationInfoOpen((open) => nextRecommendationInfoOpen(open, "leave"))} style={{ position: "relative", display: "inline-flex" }}>
              <button type="button" aria-label="How destinations are recommended" aria-expanded={recommendationInfoOpen} aria-describedby={recommendationInfoOpen ? tooltipId : undefined} onFocus={() => setRecommendationInfoOpen((open) => nextRecommendationInfoOpen(open, "focus"))} onBlur={() => setRecommendationInfoOpen((open) => nextRecommendationInfoOpen(open, "leave"))} onClick={() => setRecommendationInfoOpen((open) => nextRecommendationInfoOpen(open, "click"))} style={{ width: 18, height: 18, display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: "50%", background: C.subtle, color: C.secondary, cursor: "pointer", fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 700, lineHeight: 1, textTransform: "none", letterSpacing: "normal" }}>?</button>
              {recommendationInfoOpen && <div id={tooltipId} role="tooltip" style={{ position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", width: 240, padding: "10px 12px", zIndex: 30, background: C.ink, color: "#fff", borderRadius: 8, boxShadow: C.shadowRaised, fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 400, lineHeight: 1.5, textTransform: "none", letterSpacing: "normal" }}>Ranked by each destination&rsquo;s average activity rating in our catalog.</div>}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
        {visible.map((destination) => {
          const name = `${destination.city}, ${destination.country}`;
          const isSelected = selected === name;
          const isHovered = hovered === name;
          return (
            <button key={name} type="button" onClick={() => onSelect(destination)} onMouseEnter={() => setHovered(name)} onMouseLeave={() => setHovered(null)} style={{ minHeight: 64, textAlign: "left", padding: "16px 18px", overflow: "hidden", background: C.white, border: `2px solid ${isSelected ? C.blue : isHovered ? "#BDBDBD" : C.border}`, borderRadius: 12, cursor: "pointer", boxShadow: isSelected ? "0 0 0 3px rgba(0,114,234,0.15)" : isHovered ? C.shadowCard : "none", transition: "border-color 140ms, box-shadow 140ms", position: "relative" }}>
              {isSelected && <div style={{ position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: "50%", background: C.blue, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>}
              <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 700, color: isSelected ? C.blue : C.ink, margin: 0, paddingRight: isSelected ? 24 : 0 }}>{destination.city}</p>
              <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 13, color: isSelected ? C.blue : C.secondary, margin: "2px 0 0" }}>{destination.country}</p>
            </button>
          );
        })}
        {loading && <div style={{ gridColumn: "1 / -1", padding: 28, border: `1px dashed ${C.border}`, borderRadius: 12, background: C.white, textAlign: "center" }}><p style={{ margin: 0, fontFamily: "var(--fc-font-body)", fontSize: 13, color: C.secondary }}>Loading destinations…</p></div>}
        {!loading && search && visible.length === 0 && <div style={{ gridColumn: "1 / -1", padding: 28, border: `1px dashed ${C.border}`, borderRadius: 12, background: C.white, textAlign: "center" }}><p style={{ margin: "0 0 5px", fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 600, color: C.ink }}>No destinations found for “{search}”</p><p style={{ margin: 0, fontFamily: "var(--fc-font-body)", fontSize: 13, color: C.secondary }}>Try a different city or country.</p></div>}
      </div>
    </div>
  );
}

function PackageWizardProgress({
  labels,
  step,
  summaries,
  onStepSelect,
}: {
  labels: readonly string[];
  step: number;
  summaries: string[];
  onStepSelect: (step: number) => void;
}) {
  return (
    <div className="ai-wizard-progress" aria-label="Package setup progress">
      {labels.map((label, index) => (
        <div className="ai-wizard-progress-step" key={label}>
          <div className="ai-wizard-progress-node">
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: index <= step ? C.ink : C.white,
              border: index <= step ? "none" : `2px solid ${C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {index < step
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                : <span style={{ fontSize: 12, fontWeight: 700, color: index === step ? C.white : C.secondary }}>{index + 1}</span>}
            </div>
            {index !== step && (index < step || summaries[index]) ? (
              <button className="ai-wizard-progress-copy" type="button" onClick={() => onStepSelect(index)} style={{ minHeight: 48, padding: "4px 2px", display: "grid", alignContent: "center", justifyItems: "start", gap: 4, color: C.secondary, background: "transparent", border: 0, cursor: "pointer" }}>
                <span style={{ fontSize: 13, fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 4 }}>{label}</span>
                {summaries[index] && <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, color: C.disabled }}>{summaries[index]}</span>}
              </button>
            ) : (
              <span className="ai-wizard-progress-copy" style={{ minHeight: 48, display: "grid", alignContent: "center", gap: 4, color: index === step ? C.ink : C.secondary, whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 13, fontWeight: index === step ? 600 : 400 }}>{label}</span>
                {summaries[index] && <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, color: C.disabled }}>{summaries[index]}</span>}
              </span>
            )}
          </div>
          {index < labels.length - 1 && <div className="ai-wizard-progress-connector" />}
        </div>
      ))}
    </div>
  );
}

const VIBES = [
  { id: "chill",      label: "Chill",            desc: "Spa days, yoga sessions, and slow-paced downtime",          img: "https://images.unsplash.com/photo-1602002418816-5c0aeef426aa?w=600&h=320&fit=crop" },
  { id: "adventure",  label: "Adventure",        desc: "Active experiences and outdoor activities",                 img: "https://images.unsplash.com/photo-1533240332313-0db49b459ad6?w=600&h=320&fit=crop" },
  { id: "luxury",     label: "Luxury",           desc: "Premium stays and high-end, curated experiences",           img: "https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=600&h=320&fit=crop" },
  { id: "local",      label: "Local Experience", desc: "Walking tours, museums, and hands-on culture classes",      img: "https://images.unsplash.com/photo-1747396108528-682b02327818?w=600&h=320&fit=crop" },
  { id: "foodie",     label: "Foodie",           desc: "Street food tours, cooking classes, and night markets",     img: "https://images.unsplash.com/photo-1777576506689-d28f3b4cb33a?w=600&h=320&fit=crop" },
  { id: "scenic",     label: "Scenic",           desc: "Countryside day trips, river cruises, and scenic viewpoints", img: "https://images.unsplash.com/photo-1626948688703-0136bc0a90da?w=600&h=320&fit=crop" },
];

const DURATION_DAYS = { short: 4, mid: 7, long: 12 } as const;

/** Inverse of the wizard's duration cards — maps a stored day count back to the bucket it fits. */
export function durationBucketFromDays(days: number | null | undefined): { duration: "short" | "mid" | "long" | "custom"; customDurationDays: number } {
  if (!days || days < 2) return { duration: "short", customDurationDays: 7 };
  if (days >= 3 && days <= 5) return { duration: "short", customDurationDays: days };
  if (days >= 6 && days <= 8) return { duration: "mid", customDurationDays: days };
  if (days >= 9 && days <= 14) return { duration: "long", customDurationDays: days };
  return { duration: "custom", customDurationDays: days };
}

export function wizardDraftToPackageInput(draft: {
  destination: string;
  vibes: string[];
  duration: "short" | "mid" | "long" | "custom";
  customDurationDays: number;
  season: string;
}): CreatePackageInput {
  const destination = draft.destination.trim();
  // ponytail: naive split; the wizard's picker only offers "City, Country" names
  const comma = destination.lastIndexOf(",");
  const city = (comma === -1 ? destination : destination.slice(0, comma).trim()) || destination;
  const country = (comma === -1 ? destination : destination.slice(comma + 1).trim()) || destination;
  const vibes = draft.vibes.join(", ");
  return {
    title: `${destination} trip`.slice(0, 200),
    description: `AI-planned ${vibes ? `${vibes} ` : ""}itinerary for ${draft.season}.`,
    destination_city: city,
    destination_country: country,
    duration_days: draft.duration === "custom" ? Math.max(2, draft.customDurationDays) : DURATION_DAYS[draft.duration],
    base_price_aud: 0,
    max_group_size: null,
  };
}

const GENERATION_STEPS = [
  {
    id: "flights", label: "Flights", description: "Finding the best options...",
    statuses: ["Checking routes that keep your trip moving smoothly...", "Looking for fewer layovers and better arrival times..."],
  },
  {
    id: "hotels", label: "Hotels", description: "Selecting great places...",
    statuses: ["Finding a hotel your suitcase can call home...", "Checking locations that make mornings easier..."],
  },
  {
    id: "activities", label: "Activities", description: "Adding local experiences...",
    statuses: ["Looking beyond the obvious tourist stops...", "Mixing local favourites with memorable detours...", "Leaving a little room for happy surprises..."],
  },
  {
    id: "finalising", label: "Finalising", description: "Putting everything together...",
    statuses: ["Bringing every part of your trip together...", "Making sure each day flows naturally...", "Tucking the final details into place...", "Giving the itinerary one last thoughtful look..."],
  },
] as const;

const GENERATION_STEP_STARTS = [0, 5_000, 11_000, 18_000] as const;

export function generationVisualState(elapsedMs: number, complete: boolean) {
  if (complete) return { activeStep: GENERATION_STEPS.length, progress: 100 };
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < 5_000) return { activeStep: 0, progress: (elapsed / 5_000) * 30 };
  if (elapsed < 11_000) return { activeStep: 1, progress: 30 + ((elapsed - 5_000) / 6_000) * 25 };
  if (elapsed < 18_000) return { activeStep: 2, progress: 55 + ((elapsed - 11_000) / 7_000) * 25 };
  return { activeStep: 3, progress: Math.min(92, 80 + ((elapsed - 18_000) / 42_000) * 12) };
}

export function generationStatusMessage(elapsedMs: number, complete: boolean) {
  if (complete) return "Your trip is ready.";
  const elapsed = Math.max(0, elapsedMs);
  const { activeStep } = generationVisualState(elapsed, false);
  if (activeStep === 3 && elapsed >= 30_000) return "Still working on the finishing touches...";
  const messages = GENERATION_STEPS[activeStep].statuses;
  const timeInStep = elapsed - GENERATION_STEP_STARTS[activeStep];
  return messages[Math.floor(timeInStep / 3_000) % messages.length];
}

export function generationProgressLabel(progress: number) {
  return `${Math.round(Math.min(100, Math.max(0, progress)))}%`;
}

export function seasonChoiceComplete(season: string | null, noPreference: boolean) {
  return season !== null || noPreference;
}

export function seasonSecondaryAction(season: string | null): "build-without-season" | "clear-season" {
  return season === null ? "build-without-season" : "clear-season";
}

function GenerationIcon({ id }: { id: (typeof GENERATION_STEPS)[number]["id"] }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {id === "flights" ? (
        <><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 4 2 2 4 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/></>
      ) : id === "hotels" ? (
        <><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/></>
      ) : id === "activities" ? (
        <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></>
      ) : (
        <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"/><path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/></>
      )}
    </svg>
  );
}

function GenerationStep({
  step,
  state,
}: {
  step: (typeof GENERATION_STEPS)[number];
  state: "pending" | "active" | "complete";
}) {
  return (
    <div className={state === "active" ? "generation-step generation-step-active" : "generation-step"} style={{
      minHeight: 76, display: "grid", gridTemplateColumns: "40px minmax(0, 1fr) 24px", alignItems: "center", gap: 14,
      padding: "12px 16px", border: `1px solid ${state === "active" ? "#9BCBFA" : C.border}`, borderRadius: C.radiusMd,
      background: state === "active" ? "#F4F9FF" : C.white,
      opacity: state === "pending" ? 0.62 : 1,
      transition: "opacity 220ms ease-out, border-color 220ms ease-out, background 220ms ease-out",
    }}>
      <div style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: 10, background: state === "active" ? "#E7F2FE" : C.subtle, color: state === "active" ? C.blue : state === "complete" ? C.secondary : C.disabled, transition: "color 220ms ease-out, background 220ms ease-out" }}>
        <GenerationIcon id={step.id} />
      </div>
      <div>
        <p style={{ margin: "0 0 3px", fontFamily: "var(--fc-font-body)", fontSize: 15, lineHeight: "20px", fontWeight: 700, color: state === "pending" ? C.secondary : C.ink }}>{step.label}</p>
        <p style={{ margin: 0, fontFamily: "var(--fc-font-body)", fontSize: 13, lineHeight: "18px", color: C.secondary }}>{step.description}</p>
      </div>
      {state === "complete" ? (
        <span className="generation-check" aria-label="Complete" style={{ width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: "50%", background: "#E7F8F0" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      ) : state === "active" ? (
        <span className="generation-spinner" aria-label="In progress" style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid #CFE5FC`, borderTopColor: C.blue }} />
      ) : (
        <span aria-label="Pending" style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${C.border}` }} />
      )}
    </div>
  );
}

function PackageGenerationLoader({ elapsedMs, complete }: { elapsedMs: number; complete: boolean }) {
  const { activeStep, progress } = generationVisualState(elapsedMs, complete);
  const status = generationStatusMessage(elapsedMs, complete);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", placeItems: "center", padding: "40px 24px" }}>
      <div style={{ width: "min(520px, 100%)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{ fontFamily: "var(--fc-font-body)", fontSize: 32, lineHeight: "40px", fontWeight: 700, color: C.ink, margin: "0 0 8px", letterSpacing: "-0.02em" }}>Building your perfect trip...</h1>
          <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, lineHeight: "22px", color: C.secondary, margin: 0 }}>Our AI is crafting a personalised travel package just for you</p>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {GENERATION_STEPS.map((step, index) => (
            <GenerationStep key={step.id} step={step} state={index < activeStep ? "complete" : index === activeStep ? "active" : "pending"} />
          ))}
        </div>

        <p aria-live="polite" style={{ margin: "24px 0 12px", minHeight: 20, textAlign: "center", fontFamily: "var(--fc-font-body)", fontSize: 14, lineHeight: "20px", fontWeight: 500, color: C.secondary }}>{status}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div role="progressbar" aria-label="Trip package generation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} style={{ flex: 1, height: 7, overflow: "hidden", borderRadius: C.radiusPill, background: C.border }}>
            <div className="generation-progress-fill" style={{ width: "100%", height: "100%", borderRadius: C.radiusPill, background: complete ? C.success : C.blue, transform: `scaleX(${progress / 100})`, transformOrigin: "left center" }} />
          </div>
          <span style={{ minWidth: 36, textAlign: "right", fontFamily: "var(--fc-font-body)", fontSize: 13, lineHeight: "18px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: C.secondary }}>{generationProgressLabel(progress)}</span>
        </div>
      </div>
    </div>
  );
}

export function AIWizardScreen({ onNav, initialStep = 0, requestedStep, stepRequestId = 0, variant = "ai", editPackageId = null }: { onNav: (s: Screen) => void; initialStep?: number; requestedStep?: number; stepRequestId?: number; variant?: "ai" | "manual"; editPackageId?: string | null }) {
  const router = useRouter();
  const editBackHref = editPackageId ? `/packages/editor/${encodeURIComponent(editPackageId)}` : undefined;
  const kinds = variant === "manual" ? MANUAL_STEP_KINDS : AI_STEP_KINDS;
  const [step, setStep] = useState(initialStep);
  const [selected, setSelected] = useState<string | null>(null);
  const [dest, setDest] = useState("");
  const [destinationSearch, setDestinationSearch] = useState("");
  const { destinations, recommended, destinationsLoading } = useDestinationCatalog();
  const [hovCard, setHovCard] = useState<string | null>(null);
  const [vibes, setVibes] = useState<string[]>([]);
  const [duration, setDuration] = useState<"short" | "mid" | "long" | "custom" | null>(null);
  const [customDurationDays, setCustomDurationDays] = useState(7);
  const [season, setSeason] = useState<string | null>(null);
  const [noSeasonPreference, setNoSeasonPreference] = useState(false);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [generationComplete, setGenerationComplete] = useState(false);
  const [createdPackageId, setCreatedPackageId] = useState<string | null>(null);
  const [builtSetup, setBuiltSetup] = useState<string | null>(null);
  const inFlightSetupRef = useRef<string | null>(null);
  const [createError, setCreateError] = useState("");
  const [manualCreating, setManualCreating] = useState(false);

  // Manual builds skip AI generation entirely, so they never enter the
  // full-screen generation step — creation happens inline on the last step.
  const isLoading = variant === "ai" && step === AI_STEP_KINDS.length;

  // Editing an existing package: load its current destination/duration
  // (real fields) and vibes/season (best-effort, stashed in sessionStorage —
  // see the "Vibes/season have no backend field" note below) to prefill
  // the wizard steps instead of starting from a blank draft.
  // No "already ran" ref guard here: Strict Mode's dev-only double-invoke
  // (mount → cleanup → mount) would let the first invocation mark itself
  // done before its own cleanup ever lets it apply the fetched result,
  // silently skipping the second, real invocation and leaving every field
  // blank. `cancelled` alone is the correct guard — the stale invocation's
  // own cleanup discards its result, and the fresh one still runs.
  useEffect(() => {
    if (!editPackageId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          if (!cancelled) router.push("/login");
          return;
        }
        const existing = await fetchOwnPackage(fetch, BUILDER_API_URL, accessToken, editPackageId);
        if (cancelled) return;
        if (existing.destination_city && existing.destination_country) {
          const name = `${existing.destination_city}, ${existing.destination_country}`;
          setSelected(name);
          setDest(name);
          setDestinationSearch(name);
        }
        const { duration: bucket, customDurationDays: days } = durationBucketFromDays(existing.duration_days);
        setDuration(bucket);
        setCustomDurationDays(days);
        const vibesDraft = parseWizardVibesDraft(window.sessionStorage.getItem(wizardVibesStorageKey(editPackageId)));
        if (vibesDraft) {
          const ids = vibesDraft.vibes
            .map((label) => VIBES.find((vibe) => vibe.label === label)?.id)
            .filter((id): id is string => Boolean(id));
          if (ids.length) setVibes(ids);
          if (vibesDraft.season) setSeason(vibesDraft.season);
        }
      } catch {
        if (!cancelled) setCreateError("Unable to load this package's current settings. You can still fill them in manually.");
      }
    })();
    return () => { cancelled = true; };
  }, [editPackageId, router]);

  useEffect(() => {
    if (requestedStep === undefined) return;
    setStep(requestedStep);
  }, [requestedStep, stepRequestId]);

  useEffect(() => {
    if (!isLoading) return;
    const startedAt = Date.now() - generationElapsedMs;
    const interval = window.setInterval(() => setGenerationElapsedMs(Date.now() - startedAt), 100);
    return () => window.clearInterval(interval);
    // A new run resets elapsed time before entering the loading step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading) return;
    // One build per setup fingerprint — guards Strict Mode's double effect and
    // re-entering step 4 while a build for the same setup is still in flight.
    if (builtSetup !== null && inFlightSetupRef.current === builtSetup) return;
    const runSetup = builtSetup;
    inFlightSetupRef.current = runSetup;
    let cancelled = false;
    // ponytail: 20s timeout so a hung request lands in the catch instead of a forever-100% bar
    const timeoutFetch: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          if (!cancelled) router.push("/login");
          return;
        }
        // The /api/ai/recommend proxy has its own 120s timeout — the 20s
        // timeoutFetch above is only for the create POST.
        const selection: WizardSelection = {
          destination: selected ?? dest.trim(),
          vibes,                                   // raw ids — the engine mapping needs them
          duration,
          customDurationDays,
          season,
        };
        const res = await generateItinerary(selection);
        const base = wizardDraftToPackageInput({
          destination: selected ?? dest.trim(),
          vibes: vibes.map((vibe) => VIBES.find((item) => item.id === vibe)?.label ?? vibe),
          duration: duration ?? "short",
          customDurationDays,
          season: season ?? "",
        });
        const { package_id } = await createPackage(
          timeoutFetch,
          BUILDER_API_URL,
          accessToken,
          itineraryToPackageInput(base, res),
        );
        // Set even after cleanup: the package now exists server-side, and the
        // reuse guard in continueWizard needs the id to avoid creating a twin.
        // Skipped only when a newer build for a different setup superseded this one.
        if (inFlightSetupRef.current === runSetup) {
          setCreatedPackageId(package_id);
          setGenerationComplete(true);
        }
        // Vibes/season have no backend field to persist to (not even proposed
        // in the save/submit handover) — stashed here so the Finalise & Review
        // page can still show them once, right after creation.
        try {
          window.sessionStorage.setItem(
            wizardVibesStorageKey(package_id),
            JSON.stringify({
              vibes: vibes.map((vibeId) => VIBES.find((item) => item.id === vibeId)?.label ?? vibeId),
              season,
            }),
          );
        } catch {
          // best-effort only
        }
      } catch (error) {
        if (inFlightSetupRef.current === runSetup) inFlightSetupRef.current = null;
        if (cancelled) return;
        setCreateError(
          error instanceof DOMException && error.name === "TimeoutError"
            ? "The request timed out. Please try again."
            : error instanceof Error ? error.message : "Unable to create this package.",
        );
        setStep(AI_STEP_KINDS.length - 1);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading || !generationComplete || !createdPackageId) return;
    const timeout = window.setTimeout(() => router.push(`/packages/editor/${encodeURIComponent(createdPackageId)}`), 350);
    return () => window.clearTimeout(timeout);
  }, [isLoading, generationComplete, createdPackageId, router]);

  const kind = kinds[step];
  const isLastStep = step === kinds.length - 1;
  // Step 0 requires an actual pick from the catalog — typing alone (without
  // selecting a result) must not be enough to continue.
  const canContinue = (kind === "destination" ? selected !== null
    : kind === "style" ? vibes.length > 0
    : kind === "duration" ? duration !== null
    : seasonChoiceComplete(season, noSeasonPreference)) && !manualCreating;
  const selectDestination = (d: DestinationOption) => {
    const { name, search } = destinationSelection(d);
    setSelected(name);
    setDest(name);
    setDestinationSearch(search);
  };
  const summaryByKind: Record<WizardStepKind, string> = {
    destination: selected ?? dest.trim(),
    style: vibes.map((vibe) => VIBES.find((item) => item.id === vibe)?.label).filter(Boolean).join(", "),
    duration: duration === "custom" ? `Custom, ${customDurationDays} days` : duration ? `${duration.charAt(0).toUpperCase() + duration.slice(1)} trip` : "",
    season: season ? season.charAt(0).toUpperCase() + season.slice(1) : noSeasonPreference ? "Year-round" : "",
  };
  const stepSummaries = kinds.map((k) => summaryByKind[k]);
  const setupForSeason = (selectedSeason: string | null) => JSON.stringify({
      destination: selected ?? dest.trim(),
      vibes: [...vibes].sort(),
      duration,
      customDurationDays: duration === "custom" ? customDurationDays : null,
      season: selectedSeason,
    });
  const currentSetup = setupForSeason(season);
  const startBuild = (setup: string) => {
      // Rebuilding an unchanged setup would orphan a duplicate draft — reuse the one we made.
      if (createdPackageId && builtSetup === setup) {
        router.push(`/packages/editor/${encodeURIComponent(createdPackageId)}`);
        return;
      }
      setBuiltSetup(setup);
      setCreatedPackageId(null);
      setCreateError("");
      setGenerationElapsedMs(0);
      setGenerationComplete(false);
      setStep(AI_STEP_KINDS.length);
  };
  // Manual builds skip AI drafting — create the package directly and go
  // straight to the editor, no fake generation screen.
  const createManualPackage = async (seasonOverride: string | null = season) => {
    setCreateError("");
    setManualCreating(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) { router.push("/login"); return; }
      const styleLabels = vibes.map((vibe) => VIBES.find((item) => item.id === vibe)?.label ?? vibe);
      const base = wizardDraftToPackageInput({
        destination: selected ?? dest.trim(),
        vibes: styleLabels,
        duration: duration ?? "short",
        customDurationDays,
        season: seasonOverride ?? "",
      });
      const description = `${styleLabels.length ? `A ${styleLabels.join(", ")} trip` : "A custom trip"}${seasonOverride ? `, built for ${seasonOverride}` : ", built from scratch"}.`;
      const { package_id } = await createPackage(fetch, BUILDER_API_URL, accessToken, { ...base, description });
      router.push(`/packages/editor/${encodeURIComponent(package_id)}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Unable to create this package.");
    } finally {
      setManualCreating(false);
    }
  };
  const continueWizard = () => {
    if (!isLastStep) {
      setStep((currentStep) => currentStep + 1);
      return;
    }
    if (variant === "manual") {
      void createManualPackage();
      return;
    }
    if (editPackageId && !window.confirm(
      "Regenerating builds a brand-new itinerary from these settings. Any stops, notes, or photos you added by hand in the current one won't carry over. Continue?",
    )) return;
    startBuild(currentSetup);
  };

  const hasWizardProgress = Boolean(selected || dest.trim() || vibes.length > 0 || duration || season);

  return (
    <div className="ai-wizard-screen" style={{ minHeight: "calc(100vh - 64px)", background: "#FAFAFA", display: "flex", flexDirection: "column" }}>
      <CreatorCreationSubnav confirmBeforeLeaving={hasWizardProgress && !isLoading} backHref={editBackHref} backLabel={editPackageId ? "Cancel" : undefined} icon={editPackageId ? "x" : "chevron"} />
      {isLoading ? (
        <PackageGenerationLoader elapsedMs={generationElapsedMs} complete={generationComplete} />
      ) : (
      <div className="ai-wizard-layout">

        {/* Progress steps */}
        <PackageWizardProgress labels={kinds.map((k) => STEP_LABEL_BY_KIND[k])} step={step} summaries={stepSummaries} onStepSelect={setStep} />

        <main className="ai-wizard-main">

        {/* Heading */}
        <div className="ai-wizard-heading" style={{ marginBottom: 24 }}>
          <h1 style={{
            fontFamily: "var(--fc-font-body)", fontSize: 28, fontWeight: 700,
            color: C.ink, margin: "0 0 6px", letterSpacing: "-0.02em",
          }}>{kind === "destination" ? "Start with a destination" : kind === "style" ? "What kind of experience are you creating?" : kind === "duration" ? "Set the duration" : "Set your season"}</h1>
          <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.secondary, margin: 0 }}>
            {kind === "destination" ? "Set the foundation for your package" : kind === "style" ? (variant === "manual" ? "Choose up to 3 styles that describe your package." : "Choose up to 3 styles. We'll use them to shape your package.") : kind === "duration" ? "Plan how the journey unfolds" : "Choose when this trip is at its best. Travellers will select their own dates."}
          </p>
        </div>

        {/* Step content */}
        <div className="ai-wizard-content" style={{ minHeight: 0, overflowX: "hidden", paddingBottom: 20 }}>{kind === "season" ? (
          /* ── Step 4: Season ── */
          <div className="ai-wizard-season-grid" style={{ minHeight: 0, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {SEASON_CARDS.map((s) => {
              const isSel = season === s.id;
              const isHov = hovCard === s.id;
              return (
                <button className="ai-wizard-season-card" key={s.id}
                  onClick={() => {
                    setSeason(s.id);
                    setNoSeasonPreference(false);
                  }}
                  onMouseEnter={() => setHovCard(s.id)}
                  onMouseLeave={() => setHovCard(null)}
                  style={{
                    minHeight: 0, textAlign: "left", padding: 0, overflow: "hidden",
                    background: C.white,
                    border: `2px solid ${isSel ? C.blue : isHov ? "#BDBDBD" : C.border}`,
                    borderRadius: 12, cursor: "pointer",
                    boxShadow: isSel ? `0 0 0 3px rgba(0,114,234,0.12)` : isHov ? "0 2px 10px rgba(33,33,33,0.08)" : "0 1px 3px rgba(33,33,33,0.05)",
                    transition: "all 160ms ease",
                  }}
                >
                  <div className="ai-wizard-season-image" style={{ position: "relative", overflow: "hidden" }}>
                    <img src={s.img} alt={s.label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 320ms ease" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1.05)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1)"; }}
                    />
                    {isSel && <span aria-label="Selected" style={{ position: "absolute", top: 10, right: 10, width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: "50%", background: C.blue, color: C.white, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>}
                  </div>
                  <div className="ai-wizard-season-content" style={{ minHeight: 96, background: isSel ? "#EFF6FF" : C.white, transition: "background 160ms" }}>
                    <div className="ai-wizard-season-summary">
                      <p className="ai-wizard-season-title" style={{ minHeight: 22, fontFamily: "var(--fc-font-body)", fontWeight: 700, color: isSel ? C.blue : C.ink, margin: 0, letterSpacing: "-0.01em", transition: "color 160ms" }}>{s.label}</p>
                      <p className="ai-wizard-season-description" style={{ fontFamily: "var(--fc-font-body)", color: C.secondary, margin: 0 }}>{s.desc}</p>
                    </div>
                    <div className="ai-wizard-season-tags">
                      {s.tags.map((tag) => <span className="ai-wizard-season-meta" key={tag} style={{ padding: "2px 7px", borderRadius: 5, background: isSel ? "#DCEEFF" : C.subtle, color: isSel ? "#005AA8" : C.secondary }}>{tag}</span>)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : kind === "duration" ? (
          /* ── Step 3: Duration ── */
          <div>
            <div role="radiogroup" aria-label="Trip length" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 18 }}>
              {[
                { id: "short" as const, range: "3 to 5 days", title: "Short trip", description: "City breaks and quick getaways", path: "M5 7h14M7 4v6m10-6v6M5 11h14v9H5z" },
                { id: "mid" as const, range: "6 to 8 days", title: "Mid trip", description: "A balanced week in one region", path: "M4 18V6l5-2 6 3 5-2v12l-5 2-6-3zM9 4v12m6-9v12" },
                { id: "long" as const, range: "9 to 14 days", title: "Long trip", description: "Multi-stop and slower journeys", path: "M4 17l5-5 4 4 7-8M15 8h5v5" },
                { id: "custom" as const, range: "2 to 14 days", title: "Custom", description: "Choose an exact duration", path: "M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4" },
              ].map((option) => {
                const active = duration === option.id;
                return <button key={option.id} role="radio" aria-checked={active} onClick={() => setDuration(option.id)} style={{ minHeight: 154, padding: "18px", position: "relative", display: "grid", gridTemplateColumns: "34px 1fr", alignContent: "center", columnGap: 12, textAlign: "left", border: `2px solid ${active ? C.blue : C.border}`, borderRadius: 14, background: active ? "#EFF6FF" : C.white, boxShadow: active ? `0 0 0 3px rgba(0,114,234,0.10)` : C.shadowCard, cursor: "pointer", transition: "border-color 140ms, background 140ms, box-shadow 140ms" }}>
                  <div style={{ width: 34, height: 34, gridRow: "1 / 3", display: "grid", placeItems: "center", borderRadius: 8, background: active ? C.blue : C.subtle, color: active ? C.white : C.secondary }}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={option.path}/></svg></div>
                  {active && <div style={{ position: "absolute", top: 14, right: 14, width: 20, height: 20, display: "grid", placeItems: "center", borderRadius: "50%", background: C.blue }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>}
                  <div style={{ paddingRight: active ? 22 : 0 }}><strong style={{ display: "block", fontFamily: "var(--fc-font-body)", fontSize: 16, color: active ? C.blue : C.ink }}>{option.title}</strong><span style={{ fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 600, color: C.secondary }}>{option.range}</span></div>
                  <span style={{ gridColumn: "2", marginTop: 7, fontFamily: "var(--fc-font-body)", fontSize: 12, lineHeight: "17px", color: C.secondary }}>{option.description}</span>
                </button>;
              })}
            </div>

            {duration === "custom" && <div style={{ marginTop: 10, padding: "20px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, border: `1px solid ${C.border}`, borderRadius: 12, background: C.white }}>
              <div><strong style={{ display: "block", marginBottom: 4, fontSize: 14, color: C.ink }}>Exact duration</strong><span style={{ fontSize: 12, color: C.secondary }}>Choose from 2 to 14 days</span></div>
              <div role="group" aria-label="Custom trip duration" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" aria-label="Decrease duration" disabled={customDurationDays === 2} onClick={() => setCustomDurationDays((days) => Math.max(2, days - 1))} style={{ width: 52, height: 52, display: "grid", placeItems: "center", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: customDurationDays === 2 ? C.disabled : C.ink, cursor: customDurationDays === 2 ? "not-allowed" : "pointer" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14"/></svg></button>
                <div aria-live="polite" style={{ minWidth: 112, height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, background: C.subtle }}><strong style={{ fontFamily: "var(--fc-font-body)", fontSize: 24, lineHeight: 1, color: C.ink }}>{customDurationDays}</strong><span style={{ fontSize: 13, lineHeight: 1, fontWeight: 600, color: C.secondary }}>days</span></div>
                <button type="button" aria-label="Increase duration" disabled={customDurationDays === 14} onClick={() => setCustomDurationDays((days) => Math.min(14, days + 1))} style={{ width: 52, height: 52, display: "grid", placeItems: "center", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: customDurationDays === 14 ? C.disabled : C.ink, cursor: customDurationDays === 14 ? "not-allowed" : "pointer" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
              </div>
            </div>}

            <div style={{ minHeight: 48, marginTop: 10, padding: "0 16px", display: "flex", alignItems: "center", gap: 10, borderRadius: 10, background: C.subtle, color: C.secondary }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>
              <span style={{ fontFamily: "var(--fc-font-body)", fontSize: 13 }}>{duration === "custom" ? "AI will build the trip for your exact duration." : "AI will choose the exact duration within the selected range."}</span>
            </div>
          </div>
        ) : kind === "style" ? (
          /* ── Step 2: Travel style ── */
          <div className="ai-wizard-style-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
            {VIBES.map((v) => {
              const isSel = vibes.includes(v.id);
              const isHov = hovCard === v.id;
              const atMax = vibes.length >= 3 && !isSel;
              return (
                <button key={v.id}
                  onClick={() => {
                    if (isSel) setVibes((prev) => prev.filter((x) => x !== v.id));
                    else if (!atMax) setVibes((prev) => [...prev, v.id]);
                  }}
                  onMouseEnter={() => setHovCard(v.id)}
                  onMouseLeave={() => setHovCard(null)}
                  style={{
                    textAlign: "left", padding: 0, overflow: "hidden",
                    background: isSel ? "#EFF6FF" : C.white,
                    border: `2px solid ${isSel ? C.blue : isHov && !atMax ? "#BDBDBD" : C.border}`,
                    borderRadius: 14, cursor: atMax ? "default" : "pointer",
                    boxShadow: isSel ? `0 0 0 3px rgba(0,114,234,0.12)` : isHov && !atMax ? "0 4px 16px rgba(33,33,33,0.10)" : "0 1px 4px rgba(33,33,33,0.05)",
                    transition: "all 160ms ease",
                    display: "flex", flexDirection: "column",
                    opacity: atMax ? 0.45 : 1,
                  }}
                >
                  <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
                    <img src={v.img} alt={v.label}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 300ms ease" }}
                      onMouseEnter={(e) => { if (!atMax) (e.currentTarget as HTMLImageElement).style.transform = "scale(1.05)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1)"; }}
                    />
                    {isSel && (
                      <div style={{ position: "absolute", top: 12, right: 12, width: 26, height: 26, borderRadius: "50%", background: C.blue, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.25)" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                  </div>
                  <div style={{ height: 84, padding: "12px 16px 14px", flexShrink: 0, display: "grid", gridTemplateRows: "20px 34px", alignContent: "start", background: isSel ? "#EFF6FF" : C.white, transition: "background 160ms" }}>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, lineHeight: "20px", fontWeight: 700, color: isSel ? C.blue : C.ink, margin: 0, letterSpacing: "-0.01em", transition: "color 160ms" }}>{v.label}</p>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 12.5, color: C.secondary, margin: "4px 0 0", lineHeight: "17px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* ── Step 1: Destination ── */
          <DestinationPicker
            idPrefix="wizard"
            search={destinationSearch}
            selected={selected}
            destinations={destinations}
            recommended={recommended}
            loading={destinationsLoading}
            onSearchChange={(value) => {
              setDestinationSearch(value);
              setSelected(null);
              setDest("");
            }}
            onSelect={selectDestination}
          />
        )}</div>
        {createError && (isLastStep || editPackageId) && (
          <p role="alert" style={{ margin: "12px 0 0", fontFamily: "var(--fc-font-body)", fontSize: 13, color: "#B42318" }}>
            {createError}
          </p>
        )}
        <div className="ai-wizard-footer" style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "16px 0 20px", borderTop: `1px solid ${C.border}`, background: "#FAFAFA" }}>
          <button onClick={() => {
            if (step > 0) { setStep((s) => s - 1); return; }
            if (editBackHref) { router.push(editBackHref); return; }
            onNav("builder");
          }} style={{
            height: 44, padding: "0 24px",
            fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500,
            color: C.ink, background: C.white,
            border: `1.5px solid ${C.border}`, borderRadius: 8, cursor: "pointer",
            transition: "border-color 140ms",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#9E9E9E"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
          >Back</button>

          <div className="ai-wizard-footer-actions">
            {kind === "season" && (
              <button
                type="button"
                className="ai-wizard-no-season"
                disabled={manualCreating}
                aria-label={seasonSecondaryAction(season) === "clear-season" ? "Clear the selected season." : variant === "manual" ? "Create without a seasonal preference." : "Build without a seasonal preference."}
                onClick={() => {
                  if (seasonSecondaryAction(season) === "clear-season") {
                    setSeason(null);
                    return;
                  }
                  setSeason(null);
                  setNoSeasonPreference(true);
                  if (variant === "manual") void createManualPackage(null);
                  else startBuild(setupForSeason(null));
                }}
              >{seasonSecondaryAction(season) === "clear-season" ? "Clear season" : variant === "manual" ? "Create without season" : "Build without season"}</button>
            )}
            <button
              disabled={!canContinue}
              onClick={continueWizard}
              style={{
                height: 44, padding: "0 32px",
                fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 600,
                color: C.white,
                background: canContinue ? C.blue : C.disabled,
                border: "none", borderRadius: 8,
                cursor: canContinue ? "pointer" : "not-allowed",
                boxShadow: "none",
                transition: "opacity 140ms, box-shadow 140ms",
                display: "flex", alignItems: "center", gap: 8,
              }}
              onMouseEnter={(e) => { if (canContinue) e.currentTarget.style.opacity = "0.88"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            >
              {isLastStep ? (manualCreating ? "Creating…" : variant === "manual" ? "Create package" : editPackageId ? "Regenerate itinerary" : "Build your trip") : "Continue"}
              {!isLastStep && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        </main>
      </div>
      )}
    </div>
  );
}
