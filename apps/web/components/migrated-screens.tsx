"use client";

import { useState, useEffect } from "react";
const creatorBannerImg = "/creator-banner.png";


export type Screen = "login" | "marketplace" | "dashboard" | "builder" | "ai-wizard" | "editor";

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

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 100,
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

            {/* Sign in — white pill with globe gradient icon */}
            <button onClick={() => onNav("login")} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              height: 40, padding: "0 12px 0 4px",
              border: 0, borderRadius: 9999,
              background: "#fff", color: "#212121",
              font: "500 14px/20px var(--fc-font-body)",
              cursor: "pointer", flexShrink: 0,
            }}>
              {/* Globe gradient icon matching FC site */}
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32 }}>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="globeGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#4FC3F7"/>
                      <stop offset="40%" stopColor="#1565C0"/>
                      <stop offset="100%" stopColor="#6A1B9A"/>
                    </linearGradient>
                  </defs>
                  <circle cx="15" cy="15" r="14" fill="url(#globeGrad)"/>
                  {/* Globe lines */}
                  <ellipse cx="15" cy="15" rx="5.5" ry="14" stroke="rgba(255,255,255,0.5)" strokeWidth="1" fill="none"/>
                  <line x1="1" y1="15" x2="29" y2="15" stroke="rgba(255,255,255,0.5)" strokeWidth="1"/>
                  <line x1="3" y1="9" x2="27" y2="9" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
                  <line x1="3" y1="21" x2="27" y2="21" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
                  <circle cx="15" cy="15" r="14" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" fill="none"/>
                </svg>
              </span>
              Sign in
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#212121" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
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
        <form onSubmit={(e) => { e.preventDefault(); onNav("marketplace"); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <label style={{
              position: "absolute", top: -9, left: 12, background: C.white,
              padding: "0 4px", fontSize: 12, color: C.secondary, lineHeight: 1,
            }}>Email address *</label>
            <input
              type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
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

          {/* Continue button */}
          <button type="submit" style={{
            height: 48, background: C.blue, color: C.white,
            fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 500,
            border: "none", borderRadius: 6, cursor: "pointer",
            transition: "background 140ms",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.blueDark; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.blue; }}
          >Continue</button>
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

        {/* Creator sign-in link */}
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <button onClick={() => onNav("dashboard")} style={{
            fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary,
            background: "none", border: "none", cursor: "pointer", padding: 0,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.ink; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.secondary; }}
          >
            Are you a creator?{" "}
            <span style={{ color: C.blue, textDecoration: "underline", fontWeight: 500 }}>
              Sign in to your dashboard →
            </span>
          </button>
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
const REGION_TABS = ["UK & Europe", "Asia", "USA & Canada", "Africa"];

const TOUR_CARDS = [
  {
    img: IMG.santorini,
    save: "SAVE $1,407",
    exclusive: undefined,
    title: "Stay & Tour: Athens Discovery + Santorini Escape",
    date: "18 Feb 2026", nights: 10, country: "Greece",
    includedValue: "$1,820",
    inclusions: ["10 nights accommodation", "Flights in Greece included", "Daily breakfast included"],
    price: "$3,299", priceNote: "From per person twin share",
    creator: { name: "Sophie Laurent", handle: "@sophietravels", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=64&h=64&fit=crop&crop=face" },
  },
  {
    img: IMG.bali,
    save: "SAVE $890",
    exclusive: "EXCLUSIVE SAVE $799pp",
    title: "Fly, Stay & Tour: Best of Sri Lanka & Beaches",
    date: "4 Apr 2026", nights: 15, country: "Sri Lanka",
    includedValue: "$2,100",
    inclusions: ["15 nights accommodation", "Return flights to Colombo", "Guided cultural tours"],
    price: "$4,199", priceNote: "From per person twin share",
    creator: { name: "Marcus Chen", handle: "@marcuswanders", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=64&h=64&fit=crop&crop=face" },
  },
  {
    img: IMG.morocco,
    save: "SAVE $1,240",
    exclusive: undefined,
    title: "Fly, Stay & Tour: Casablanca Stay and Morocco Encompassed",
    date: "21 Nov 2026", nights: 18, country: "Morocco",
    includedValue: "$2,560",
    inclusions: ["18 nights accommodation", "Intercity flights included", "Guided desert excursion"],
    price: "$5,499", priceNote: "From per person twin share",
    creator: { name: "Aisha Okonkwo", handle: "@aishaexplores", avatar: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=64&h=64&fit=crop&crop=face" },
  },
  {
    img: IMG.tokyo,
    save: undefined,
    exclusive: "EXCLUSIVE SAVE $500pp",
    title: "Ancient Shores & Island Escapes: Dubrovnik to the Greek Islands",
    date: "11 May 2026", nights: 27, country: "Croatia & Greece",
    includedValue: "$3,400",
    inclusions: ["27 nights accommodation", "Flights to Dubrovnik included", "Scenic island cruise"],
    price: "$7,299", priceNote: "From per person twin share",
    creator: { name: "Lena Hoffmann", handle: "@lenahoffmann", avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=64&h=64&fit=crop&crop=face" },
  },
];

export function MarketplaceScreen() {
  const [search, setSearch] = useState("");
  const [activeRegion, setActiveRegion] = useState("UK & Europe");

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
          <div style={{
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
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#212121" style={{ flexShrink: 0, marginRight: 14, opacity: 0.55 }}>
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="All destinations"
                style={{
                  flex: 1, border: "none", outline: "none", background: "transparent",
                  fontFamily: "var(--fc-font-body)", fontSize: 17, color: C.ink,
                }}
              />
            </div>

            {/* Row 2: filters + search button */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              paddingBottom: 24,
            }}>
              <div style={{ display: "flex", gap: 4 }}>
                {["All departure dates", "All trip types"].map((label) => (
                  <button key={label} style={{
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
          </div>
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

        {/* Region tabs + arrows */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {REGION_TABS.map((r) => {
              const on = activeRegion === r;
              return (
                <button key={r} onClick={() => setActiveRegion(r)} style={{
                  fontFamily: "var(--fc-font-body)", fontSize: 16, fontWeight: on ? 600 : 400,
                  color: on ? C.ink : C.secondary,
                  background: on ? C.subtle : "none",
                  border: on ? `1px solid ${C.border}` : "1px solid transparent",
                  borderRadius: 999, padding: "10px 22px",
                  cursor: "pointer", transition: "all 140ms",
                }}>
                  {r}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <a href="#" style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.ink, fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3, marginRight: 4 }}>See all</a>
            {(["M15 18l-6-6 6-6", "M9 18l6-6-6-6"] as const).map((d, i) => (
              <button key={i} style={{
                width: 40, height: 40, borderRadius: "50%",
                border: `1px solid ${C.border}`, background: C.white,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={d}/>
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* 4-col tour card grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 56 }}>
          {TOUR_CARDS.map((card) => (
            <div key={card.title} style={{
              borderRadius: 14, overflow: "hidden",
              border: `1px solid ${C.border}`,
              background: C.white,
              boxShadow: C.shadowCard,
              display: "flex", flexDirection: "column",
            }}>
              {/* Image */}
              <div style={{ position: "relative", aspectRatio: "3/2", overflow: "hidden" }}>
                <img src={card.img} alt={card.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                {card.save && (
                  <span style={{
                    position: "absolute", top: 12, left: 12,
                    background: "#C8001A", color: "#fff",
                    fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 700,
                    padding: "5px 10px", borderRadius: 5, letterSpacing: "0.02em",
                  }}>{card.save}</span>
                )}
                {card.exclusive && (
                  <span style={{
                    position: "absolute", top: 12, right: 12,
                    background: "#1A1A1A", color: "#fff",
                    fontFamily: "var(--fc-font-body)", fontSize: 11, fontWeight: 700,
                    padding: "5px 10px", borderRadius: 5, letterSpacing: "0.02em",
                    maxWidth: 120, textAlign: "center", lineHeight: "15px",
                  }}>{card.exclusive}</span>
                )}
              </div>

              {/* Body */}
              <div style={{ padding: "18px 18px 20px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0 }}>
                  {card.date} · {card.nights} nights · {card.country}
                </p>
                <p style={{
                  fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 600,
                  color: C.ink, margin: 0, lineHeight: "22px",
                  display: "-webkit-box", WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {card.title}
                </p>

                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginTop: 2 }}>
                  <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 700, color: C.secondary, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Included value <span style={{ color: C.ink }}>{card.includedValue}</span>
                  </p>
                  {card.inclusions.map((inc) => (
                    <div key={inc} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 5 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill={C.blue} style={{ flexShrink: 0, marginTop: 2 }}>
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                      </svg>
                      <span style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, lineHeight: "20px" }}>{inc}</span>
                    </div>
                  ))}
                </div>

                {/* Creator info */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 0", borderTop: `1px solid ${C.border}`, marginTop: 6,
                }}>
                  <img src={card.creator.avatar} alt={card.creator.name} style={{
                    width: 34, height: 34, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
                  }} />
                  <div>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 600, color: C.ink, margin: 0, lineHeight: "20px" }}>{card.creator.name}</p>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0, lineHeight: "18px" }}>{card.creator.handle}</p>
                  </div>
                  <span style={{
                    marginLeft: "auto", background: "#EEF5FF", color: C.blue,
                    fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 700,
                    padding: "4px 10px", borderRadius: 999, letterSpacing: "0.05em", flexShrink: 0,
                  }}>CREATOR</span>
                </div>

                <div style={{ paddingTop: 6 }}>
                  <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 12, color: C.secondary, margin: "0 0 3px" }}>{card.priceNote}</p>
                  <p style={{ fontFamily: "var(--fc-font-display)", fontSize: 24, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: "-0.01em" }}>{card.price}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center" }}>
          <BtnSecondary>Load more trips</BtnSecondary>
        </div>
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
const PACKAGES = [
  { name: "Tokyo Food & Culture Experience",   duration: "7 days / 6 nights",  updated: "2 days ago",  status: "Approved",     statusColor: C.success,   statusBg: "#ECFDF5", views: 285,  bookings: 12, revenue: "$42,800", commission: "$8,568",  rowAction: "Manage" },
  { name: "Iceland Northern Lights Adventure", duration: "5 days / 4 nights",  updated: "1 week ago",  status: "Approved",     statusColor: C.success,   statusBg: "#ECFDF5", views: 210,  bookings: 8,  revenue: "$31,200", commission: "$6,240",  rowAction: "Manage" },
  { name: "Bali Wellness & Beach Retreat",     duration: "10 days / 9 nights", updated: "3 hours ago", status: "Under review", statusColor: C.warning,   statusBg: "#FFF8EC", views: null, bookings: null, revenue: null, commission: null, rowAction: "View" },
  { name: "Morocco Desert & Medinas",          duration: "6 days / 5 nights",  updated: "5 days ago",  status: "Draft",        statusColor: C.secondary, statusBg: C.subtle,  views: null, bookings: null, revenue: null, commission: null, rowAction: "Continue editing" },
];

const STATS = [
  { label: "Packages", value: "4", sub: "Current — 2 active" },
  { label: "Bookings", value: "20", sub: "This quarter" },
  { label: "Booking value", value: "$74.0k", sub: "This quarter" },
  { label: "Your commission", value: "$14.8k", sub: "This quarter" },
];

export function DashboardScreen({ onNav: _onNav }: { onNav: (s: Screen) => void }) {
  const [activeTab, setActiveTab] = useState("All");
  const [hovRow, setHovRow] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const tabs = ["All", "Approved", "Under review", "Drafts"];

  const filtered = activeTab === "All"
    ? PACKAGES
    : PACKAGES.filter((p) => p.status === activeTab || (activeTab === "Drafts" && p.status === "Draft"));

  const cols = {
    grid: "minmax(0,1.8fr) 140px 88px 96px 128px 128px 140px",
    headers: [
      { h: "Package",        align: "left"  },
      { h: "Status",         align: "left"  },
      { h: "Views",          align: "right" },
      { h: "Bookings",       align: "right" },
      { h: "Booking value",  align: "right" },
      { h: "Commission",     align: "right" },
      { h: "Actions",        align: "right" },
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
          {STATS.map(({ label, value, sub }) => (
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
          <div style={{ display: "grid", gridTemplateColumns: cols.grid, padding: "14px 28px", background: "#FAFAFA", borderBottom: `1px solid ${C.border}` }}>
            {cols.headers.map(({ h, align }) => (
              <p key={h} style={{
                fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 400,
                color: C.secondary, margin: 0,
                textAlign: align as "left" | "right",
              }}>{h}</p>
            ))}
          </div>

          {/* Rows */}
          {filtered.map((pkg, i) => {
            const hov = hovRow === pkg.name;
            return (
              <div key={pkg.name}
                style={{
                  display: "grid", gridTemplateColumns: cols.grid,
                  padding: "22px 28px", alignItems: "center",
                  borderBottom: i < filtered.length - 1 ? `1px solid #F0F0F0` : "none",
                  background: hov ? "#FAFAFA" : "transparent",
                  transition: "background 120ms", cursor: "pointer",
                }}
                onMouseEnter={() => setHovRow(pkg.name)}
                onMouseLeave={() => setHovRow(null)}
              >
                {/* Package name */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <p style={{
                      fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500,
                      color: hov ? C.blue : C.ink,
                      textDecoration: hov ? "underline" : "none",
                      textUnderlineOffset: 2,
                      margin: 0, lineHeight: "20px", transition: "color 120ms",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{pkg.name}</p>
                    <svg
                      width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke={C.blue} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ flexShrink: 0, opacity: hov ? 1 : 0, transition: "opacity 140ms" }}
                    >
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </div>
                  <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, color: C.secondary, margin: 0 }}>
                    {pkg.duration}<span style={{ margin: "0 6px", opacity: 0.35 }}>·</span>Updated {pkg.updated}
                  </p>
                </div>

                {/* Status badge */}
                <div>
                  <span style={{
                    fontFamily: "var(--fc-font-body)", fontSize: 13, fontWeight: 500,
                    color: pkg.statusColor, background: pkg.statusBg,
                    padding: "5px 12px", borderRadius: C.radiusPill,
                    display: "inline-block", whiteSpace: "nowrap",
                  }}>{pkg.status}</span>
                </div>

                {/* Numeric cells */}
                {[pkg.views, pkg.bookings, pkg.revenue, pkg.commission].map((val, j) => (
                  <p key={j} style={{
                    fontFamily: "var(--fc-font-body)", fontSize: 15,
                    fontWeight: 400,
                    color: val != null ? C.ink : C.disabled,
                    margin: 0, textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}>{val ?? "—"}</p>
                ))}

                {/* Row action */}
                <div style={{ textAlign: "right" }}>
                  <button style={{
                    fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500,
                    color: C.ink, background: "none",
                    border: `1px solid ${C.border}`,
                    borderRadius: 6, padding: "5px 14px", cursor: "pointer",
                    whiteSpace: "nowrap",
                    opacity: hov ? 1 : 0.75, transition: "opacity 140ms, border-color 140ms",
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#9E9E9E"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
                  >{pkg.rowAction}</button>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

// ─── Creator Nav (dashboard only) ─────────────────────────────────────────────
const CREATOR_NAV_ITEMS = ["Dashboard", "My Packages", "Bookings", "Earnings", "Analytics"];

export function CreatorNav({ activeItem, onItem, onNav }: {
  activeItem: string;
  onItem: (s: string) => void;
  onNav: (s: Screen) => void;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const CONTAINER = "min(calc(100% - 80px), 1200px)";

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
              <button onClick={() => setProfileOpen((o) => !o)} style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                height: 40, padding: "0 12px 0 4px",
                border: 0, borderRadius: 9999,
                background: "#fff", color: "#212121",
                fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500,
                cursor: "pointer", flexShrink: 0,
              }}>
                <img
                  src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=64&h=64&fit=crop&crop=face"
                  alt="Profile"
                  style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", margin: "0 2px" }}
                />
                Sophie L.
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
                    { label: "Log out",            action: () => { onNav("login"); setProfileOpen(false); } },
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

      {/* ── White workspace nav: tabs ── */}
      <div style={{
        width: "100%", height: 52, background: C.white,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "stretch",
      }}>
        <div style={{
          width: CONTAINER, margin: "0 auto",
          display: "flex", alignItems: "stretch", gap: 32,
        }}>
          {CREATOR_NAV_ITEMS.map((item) => {
            const active = activeItem === item;
            return (
              <button key={item} onClick={() => onItem(item)} style={{
                fontFamily: "var(--fc-font-body)", fontSize: 15,
                fontWeight: active ? 600 : 500,
                color: active ? C.ink : C.secondary,
                background: "none", border: "none",
                borderBottom: active ? `3px solid ${C.red}` : "3px solid transparent",
                padding: "0 2px",
                cursor: "pointer", transition: "color 120ms, border-color 120ms",
                whiteSpace: "nowrap",
              }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = C.ink; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = C.secondary; }}
              >{item}</button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ─── Builder Screen ────────────────────────────────────────────────────────────
export function BuilderScreen({ onNav }: { onNav: (s: Screen) => void }) {
  const [hovScratch, setHovScratch] = useState(false);

  const steps = [
    { n: 1, label: "Pick destination", icon: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" },
    { n: 2, label: "AI drafts your itinerary", icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z" },
    { n: 3, label: "Review, customise & publish", icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" },
    { n: 4, label: "Share & earn on bookings", icon: "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z" },
  ];

  return (
    <div style={{ height: "calc(100vh - 116px)", background: C.subtle, overflowY: "auto" }}>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "64px 24px 48px" }}>


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
            onClick={() => {}}
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
const DESTINATIONS = [
  { name: "Tokyo, Japan",      tags: ["Food & Culture", "City"],   img: "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?w=400&h=180&fit=crop" },
  { name: "Paris, France",     tags: ["Romance", "Culture"],       img: "https://images.unsplash.com/photo-1511739001486-6bfe10ce785f?w=400&h=180&fit=crop" },
  { name: "Bali, Indonesia",   tags: ["Beach", "Wellness"],        img: "https://images.unsplash.com/photo-1555400038-63f5ba517a47?w=400&h=180&fit=crop" },
  { name: "Iceland",           tags: ["Nature", "Adventure"],      img: "https://images.unsplash.com/photo-1488415032361-b7e238421f1b?w=400&h=180&fit=crop" },
  { name: "New York, USA",     tags: ["City", "Shopping"],         img: "https://images.unsplash.com/photo-1496588152823-86ff7695e68f?w=400&h=180&fit=crop" },
  { name: "Santorini, Greece", tags: ["Beach", "Romance"],         img: "https://images.unsplash.com/photo-1672622851784-0dbd3df4c088?w=400&h=180&fit=crop" },
];

const WIZARD_STEPS = ["Destination", "Travel style", "Duration", "Season"];

const VIBES = [
  { id: "chill",      label: "Chill",            desc: "Slow-paced, relaxing travel with minimal planning", img: "https://images.unsplash.com/photo-1602002418816-5c0aeef426aa?w=600&h=320&fit=crop" },
  { id: "adventure",  label: "Adventure",        desc: "Active experiences and outdoor activities",          img: "https://images.unsplash.com/photo-1533240332313-0db49b459ad6?w=600&h=320&fit=crop" },
  { id: "luxury",     label: "Luxury",           desc: "Premium stays and high-end, curated experiences",    img: "https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=600&h=320&fit=crop" },
  { id: "local",      label: "Local Experience", desc: "Authentic, immersive moments with local culture",     img: "https://images.unsplash.com/photo-1747396108528-682b02327818?w=600&h=320&fit=crop" },
  { id: "foodie",     label: "Foodie",           desc: "Explore destinations through food and drink",         img: "https://images.unsplash.com/photo-1777576506689-d28f3b4cb33a?w=600&h=320&fit=crop" },
  { id: "scenic",     label: "Scenic",           desc: "Beautiful views, nature, and photo-worthy spots",      img: "https://images.unsplash.com/photo-1626948688703-0136bc0a90da?w=600&h=320&fit=crop" },
];

export function AIWizardScreen({ onNav, initialStep = 0, requestedStep, stepRequestId = 0, hasBuilt = false }: { onNav: (s: Screen) => void; initialStep?: number; requestedStep?: number; stepRequestId?: number; hasBuilt?: boolean }) {
  const [step, setStep] = useState(initialStep);
  const [selected, setSelected] = useState<string | null>(null);
  const [dest, setDest] = useState("");
  const [destinationSearch, setDestinationSearch] = useState("");
  const [hovCard, setHovCard] = useState<string | null>(null);
  const [vibes, setVibes] = useState<string[]>([]);
  const [duration, setDuration] = useState<"short" | "mid" | "long" | "custom" | null>(null);
  const [customDurationDays, setCustomDurationDays] = useState(7);
  const [season, setSeason] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [lastBuiltSetup, setLastBuiltSetup] = useState<string | null>(null);

  const isLoading = step === 4;

  useEffect(() => {
    if (requestedStep === undefined) return;
    setStep(requestedStep);
  }, [requestedStep, stepRequestId]);

  useEffect(() => {
    if (!isLoading) return;
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { clearInterval(interval); return 100; }
        return p + (p < 60 ? 1.2 : p < 85 ? 0.6 : 0.3);
      });
    }, 60);
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading || progress < 100) return;
    const timeout = window.setTimeout(() => onNav("editor"), 500);
    return () => window.clearTimeout(timeout);
  }, [isLoading, progress, onNav]);

  const canContinue = step === 0 ? (selected !== null || dest.trim().length > 0) : step === 1 ? vibes.length > 0 : step === 2 ? duration !== null : step === 3 ? season !== null : true;
  const filteredDestinations = DESTINATIONS.filter((destination) => {
    const query = destinationSearch.trim().toLowerCase();
    return !query || destination.name.toLowerCase().includes(query) || destination.tags.some((tag) => tag.toLowerCase().includes(query));
  });
  const stepSummaries = [
    selected ?? dest.trim(),
    vibes.map((vibe) => VIBES.find((item) => item.id === vibe)?.label).filter(Boolean).join(", "),
    duration === "custom" ? `Custom, ${customDurationDays} ${customDurationDays === 1 ? "day" : "days"}` : duration ? `${duration.charAt(0).toUpperCase() + duration.slice(1)} trip` : "",
    season ? season.charAt(0).toUpperCase() + season.slice(1) : "",
  ];
  const currentSetup = JSON.stringify({
    destination: selected ?? dest.trim(),
    travelStyles: [...vibes].sort(),
    duration,
    customDurationDays: duration === "custom" ? customDurationDays : null,
    season,
  });
  const setupHasChanged = lastBuiltSetup !== null && currentSetup !== lastBuiltSetup;
  const continueWizard = () => {
    if (step === 3) {
      if (hasBuilt && !setupHasChanged) {
        onNav("editor");
        return;
      }
      setLastBuiltSetup(currentSetup);
      setProgress(0);
      setStep(4);
      return;
    }
    setStep((currentStep) => currentStep + 1);
  };

  return (
    <div style={{ height: "calc(100vh - 116px)", background: "#FAFAFA", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {isLoading ? (
        /* ── Loading screen ── */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
          <h1 style={{ fontFamily: "var(--fc-font-body)", fontSize: 32, fontWeight: 700, color: C.ink, margin: "0 0 10px", letterSpacing: "-0.02em" }}>
            Building your perfect trip ...
          </h1>
          <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.secondary, margin: "0 0 36px" }}>
            Our AI is crafting a personalised travel package trip just for you
          </p>
          <div style={{ width: 320, height: 260, borderRadius: 16, overflow: "hidden", marginBottom: 40, background: C.subtle }}>
            <img src="https://images.unsplash.com/photo-1654693289021-3ff2c9df4092?w=640&h=520&fit=crop" alt="Building trip" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ width: 560, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, height: 8, borderRadius: 99, background: C.border, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "100%", borderRadius: 99, background: C.ink, transform: `scaleX(${Math.min(progress, 100) / 100})`, transformOrigin: "left center", transition: "transform 60ms linear" }} />
            </div>
            <span style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 600, color: C.ink, minWidth: 40, textAlign: "right" }}>
              {Math.min(Math.round(progress), 100)}%
            </span>
          </div>
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", maxWidth: 960, margin: "0 auto", width: "100%", padding: "40px 32px 0" }}>

        {/* Progress steps */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 36 }}>
          {WIZARD_STEPS.map((label, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", flex: i < WIZARD_STEPS.length - 1 ? 1 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  background: i < step ? C.ink : i === step ? C.ink : C.white,
                  border: i === step ? `2px solid ${C.ink}` : i < step ? "none" : `2px solid ${C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 300ms",
                }}>
                  {i < step
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    : <span style={{ fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 700, color: i === step ? C.white : C.secondary }}>{i + 1}</span>
                  }
                </div>
                {i < step ? (
                  <button
                    type="button"
                    onClick={() => setStep(i)}
                    aria-label={`Return to ${label}`}
                    style={{
                      minHeight: 48, padding: "4px 2px",
                      display: "grid", alignContent: "center", justifyItems: "start", gap: 4,
                      fontFamily: "var(--fc-font-body)", color: C.secondary, whiteSpace: "nowrap",
                      background: "transparent", border: 0, cursor: "pointer",
                    }}
                  ><span style={{ fontSize: 13, fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 4 }}>{label}</span>{stepSummaries[i] && <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, color: C.disabled }}>{stepSummaries[i]}</span>}</button>
                ) : (
                  <span style={{ minHeight: 48, display: "grid", alignContent: "center", gap: 4, fontFamily: "var(--fc-font-body)", color: i === step ? C.ink : C.secondary, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 13, fontWeight: i === step ? 600 : 400 }}>{label}</span>
                    {stepSummaries[i] && <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", fontSize: 11, fontWeight: 400, color: C.disabled }}>{stepSummaries[i]}</span>}
                  </span>
                )}
              </div>
              {i < WIZARD_STEPS.length - 1 && (
                <div style={{ flex: 1, height: 1.5, background: C.border, margin: "0 12px", transition: "background 300ms" }} />
              )}
            </div>
          ))}
        </div>

        {/* Heading */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{
            fontFamily: "var(--fc-font-body)", fontSize: 28, fontWeight: 700,
            color: C.ink, margin: "0 0 6px", letterSpacing: "-0.02em",
          }}>{step === 0 ? "Start with a destination" : step === 1 ? "What kind of experience are you creating?" : step === 2 ? "Set the duration" : "Set your season"}</h1>
          <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.secondary, margin: 0 }}>
            {step === 0 ? "Set the foundation for your package" : step === 1 ? "Choose up to 3 styles. We'll use them to shape your package." : step === 2 ? "Plan how the journey unfolds" : "Define when this package is best experienced"}
          </p>
        </div>

        {/* Step content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: 20 }}>{step === 3 ? (
          /* ── Step 4: Season ── */
          <div style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gridTemplateRows: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {([
              { id: "spring", label: "Spring", desc: "Blooming scenery and fresh, vibrant energy", img: "https://images.unsplash.com/photo-1622285422722-b1b3eb36c728?w=600&h=320&fit=crop", recommend: true },
              { id: "summer", label: "Summer", desc: "Warm days and endless outdoor adventures",   img: "https://images.unsplash.com/photo-1461937995729-a2e442122d18?w=600&h=320&fit=crop" },
              { id: "autumn", label: "Autumn",  desc: "Colorful foliage and cozy moments",          img: "https://images.unsplash.com/photo-1542574929305-245cb48f9c87?w=600&h=320&fit=crop" },
              { id: "winter", label: "Winter",  desc: "Cool weather and relaxed experiences",       img: "https://images.unsplash.com/photo-1551927411-95e412943b58?w=600&h=320&fit=crop" },
            ] as { id: string; label: string; desc: string; img: string; recommend?: boolean }[]).map((s) => {
              const isSel = season === s.id;
              const isHov = hovCard === s.id;
              return (
                <button key={s.id}
                  onClick={() => setSeason(s.id)}
                  onMouseEnter={() => setHovCard(s.id)}
                  onMouseLeave={() => setHovCard(null)}
                  style={{
                    minHeight: 0, textAlign: "left", padding: 0, overflow: "hidden",
                    background: C.white,
                    border: `2px solid ${isSel ? C.blue : isHov ? "#BDBDBD" : C.border}`,
                    borderRadius: 12, cursor: "pointer",
                    boxShadow: isSel ? `0 0 0 3px rgba(0,114,234,0.12)` : isHov ? "0 2px 10px rgba(33,33,33,0.08)" : "0 1px 3px rgba(33,33,33,0.05)",
                    transition: "all 160ms ease",
                    display: "flex", flexDirection: "column",
                  }}
                >
                  <div style={{ position: "relative", flex: "1 1 100px", minHeight: 76, overflow: "hidden" }}>
                    <img src={s.img} alt={s.label} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 320ms ease" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1.05)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLImageElement).style.transform = "scale(1)"; }}
                    />
                    {isSel && (
                      <div style={{ position: "absolute", top: 10, right: 10, width: 22, height: 22, borderRadius: "50%", background: C.blue, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                    {s.recommend && (
                      <div style={{ position: "absolute", top: 10, left: 10 }}>
                        <span style={{ fontFamily: "var(--fc-font-body)", fontSize: 10, fontWeight: 700, color: C.white, background: C.red, borderRadius: 4, padding: "2px 7px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Recommend</span>
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, padding: "10px 14px 12px", background: isSel ? "#EFF6FF" : C.white, transition: "background 160ms" }}>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 700, color: isSel ? C.blue : C.ink, margin: "0 0 3px", letterSpacing: "-0.01em", transition: "color 160ms" }}>{s.label}</p>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 12, color: C.secondary, margin: 0, lineHeight: "16px" }}>{s.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : step === 2 ? (
          /* ── Step 3: Duration ── */
          <div>
            <div role="radiogroup" aria-label="Trip length" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 18 }}>
              {[
                { id: "short" as const, range: "3 to 5 days", title: "Short trip", description: "City breaks and quick getaways", path: "M5 7h14M7 4v6m10-6v6M5 11h14v9H5z" },
                { id: "mid" as const, range: "6 to 8 days", title: "Mid trip", description: "A balanced week in one region", path: "M4 18V6l5-2 6 3 5-2v12l-5 2-6-3zM9 4v12m6-9v12" },
                { id: "long" as const, range: "9 to 14 days", title: "Long trip", description: "Multi-stop and slower journeys", path: "M4 17l5-5 4 4 7-8M15 8h5v5" },
                { id: "custom" as const, range: "1 to 14 days", title: "Custom", description: "Choose an exact duration", path: "M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4" },
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
              <div><strong style={{ display: "block", marginBottom: 4, fontSize: 14, color: C.ink }}>Exact duration</strong><span style={{ fontSize: 12, color: C.secondary }}>Choose from 1 to 14 days</span></div>
              <div role="group" aria-label="Custom trip duration" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" aria-label="Decrease duration" disabled={customDurationDays === 1} onClick={() => setCustomDurationDays((days) => Math.max(1, days - 1))} style={{ width: 52, height: 52, display: "grid", placeItems: "center", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: customDurationDays === 1 ? C.disabled : C.ink, cursor: customDurationDays === 1 ? "not-allowed" : "pointer" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14"/></svg></button>
                <div aria-live="polite" style={{ minWidth: 112, height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 8, background: C.subtle }}><strong style={{ fontFamily: "var(--fc-font-body)", fontSize: 24, lineHeight: 1, color: C.ink }}>{customDurationDays}</strong><span style={{ fontSize: 13, lineHeight: 1, fontWeight: 600, color: C.secondary }}>{customDurationDays === 1 ? "day" : "days"}</span></div>
                <button type="button" aria-label="Increase duration" disabled={customDurationDays === 14} onClick={() => setCustomDurationDays((days) => Math.min(14, days + 1))} style={{ width: 52, height: 52, display: "grid", placeItems: "center", border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: customDurationDays === 14 ? C.disabled : C.ink, cursor: customDurationDays === 14 ? "not-allowed" : "pointer" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
              </div>
            </div>}

            <div style={{ minHeight: 48, marginTop: 10, padding: "0 16px", display: "flex", alignItems: "center", gap: 10, borderRadius: 10, background: C.subtle, color: C.secondary }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>
              <span style={{ fontFamily: "var(--fc-font-body)", fontSize: 13 }}>{duration === "custom" ? "AI will build the trip for your exact duration." : "AI will choose the exact duration within the selected range."}</span>
            </div>
          </div>
        ) : step === 1 ? (
          /* ── Step 2: Travel style ── */
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(2, 1fr)", gap: 16, height: "100%" }}>
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
          <div>
          <label style={{ display: "block", margin: "0 0 24px" }}>
            <span style={{ display: "block", fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.secondary, marginBottom: 10 }}>
              Search destinations
            </span>
            <div style={{ position: "relative" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.secondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                value={destinationSearch}
                onChange={(e) => { setDestinationSearch(e.target.value); setDest(e.target.value); setSelected(null); }}
                placeholder="Search by city, country or travel style…"
                style={{
                  width: "100%", boxSizing: "border-box", height: 52,
                  paddingLeft: 48, paddingRight: destinationSearch ? 48 : 16,
                  fontFamily: "var(--fc-font-body)", fontSize: 15, color: C.ink,
                  border: `1.5px solid ${C.border}`, borderRadius: 12, outline: "none",
                  background: C.white, boxShadow: C.shadowCard,
                  transition: "border-color 140ms, box-shadow 140ms",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.boxShadow = `0 0 0 3px ${C.focusRing}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = C.shadowCard; }}
              />
              {destinationSearch && <button type="button" aria-label="Clear destination search" onClick={() => { setDestinationSearch(""); setDest(""); setSelected(null); }} style={{ position: "absolute", right: 6, top: 4, width: 44, height: 44, display: "grid", placeItems: "center", border: 0, background: "transparent", color: C.secondary, cursor: "pointer" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
              </button>}
            </div>
          </label>
          <div style={{ minHeight: 32, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
            <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.secondary, margin: 0 }}>
              {destinationSearch ? `${filteredDestinations.length} matching destinations` : "Popular Destinations"}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
            {filteredDestinations.map((d) => {
              const isSel = selected === d.name;
              const isHov = hovCard === d.name;
              return (
                <button key={d.name}
                  onClick={() => { setSelected(d.name); setDest(d.name); }}
                  onMouseEnter={() => setHovCard(d.name)}
                  onMouseLeave={() => setHovCard(null)}
                  style={{
                    minHeight: 92, textAlign: "left", padding: "16px 18px", overflow: "hidden",
                    background: C.white,
                    border: `2px solid ${isSel ? C.blue : isHov ? "#BDBDBD" : C.border}`,
                    borderRadius: 12, cursor: "pointer",
                    boxShadow: isSel ? "0 0 0 3px rgba(0,114,234,0.15)" : isHov ? C.shadowCard : "none",
                    transition: "border-color 140ms, box-shadow 140ms",
                    position: "relative",
                  }}
                >
                  {isSel && <div style={{ position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: "50%", background: C.blue, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>}
                  <div>
                    <p style={{ fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 700, color: isSel ? C.blue : C.ink, margin: "0 0 10px", paddingRight: isSel ? 24 : 0 }}>{d.name}</p>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {d.tags.map((tag) => (
                        <span key={tag} style={{
                          fontFamily: "var(--fc-font-body)", fontSize: 11, fontWeight: 500,
                          color: isSel ? C.blue : C.secondary,
                          background: isSel ? "rgba(0,114,234,0.08)" : C.subtle,
                          borderRadius: 4, padding: "2px 7px",
                          transition: "color 140ms, background 140ms",
                        }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredDestinations.length === 0 && (
              <div style={{ gridColumn: "1 / -1", padding: "28px", border: `1px dashed ${C.border}`, borderRadius: 12, background: C.white, textAlign: "center" }}>
                <p style={{ margin: "0 0 5px", fontFamily: "var(--fc-font-body)", fontSize: 15, fontWeight: 600, color: C.ink }}>Create a trip to “{destinationSearch}”</p>
                <p style={{ margin: 0, fontFamily: "var(--fc-font-body)", fontSize: 13, color: C.secondary }}>No preset found, but you can continue and let AI build it.</p>
              </div>
            )}
          </div>
        </div>
        )}</div>
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 20px", borderTop: `1px solid ${C.border}`, background: "#FAFAFA" }}>
          <button onClick={() => step === 0 ? onNav("builder") : setStep((s) => s - 1)} style={{
            height: 44, padding: "0 24px",
            fontFamily: "var(--fc-font-body)", fontSize: 14, fontWeight: 500,
            color: C.ink, background: C.white,
            border: `1.5px solid ${C.border}`, borderRadius: 8, cursor: "pointer",
            transition: "border-color 140ms",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#9E9E9E"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
          >Back</button>

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
            {step === 3 ? (hasBuilt ? (setupHasChanged ? "Rebuild your trip" : "Back to trip") : "Build your trip") : "Continue"}
            {step < 3 && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            )}
          </button>
        </div>

      </div>
      )}
    </div>
  );
}
