"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { marketplaceNavigationItems } from "./navigation-model";
import { APP_ROUTES } from "../lib/routes";

export function MarketplaceHeader() {
  const pathname = usePathname();

  return (
    <header className="marketplace-header">
      <div className="marketplace-header__inner">
        <div className="marketplace-header__top">
          <Link className="marketplace-wordmark" href={APP_ROUTES.marketplace}>
            <strong>TRAVEL MARKETPLACE</strong>
            <span>Your centre for travel.</span>
          </Link>
          <nav className="marketplace-utilities" aria-label="Account and support">
            <button type="button">Get the app</button>
            <button type="button">Get a quote</button>
            <button type="button">Help</button>
            <Link className="marketplace-sign-in" href={APP_ROUTES.login}>
              <span aria-hidden="true">◎</span> Sign in
            </Link>
          </nav>
        </div>
        <nav className="marketplace-products" aria-label="Main navigation">
          {marketplaceNavigationItems.map((label) => (
            <Link key={label} href={APP_ROUTES.marketplace}>
              {label}
            </Link>
          ))}
          <Link
            className={pathname === APP_ROUTES.marketplace ? "active" : undefined}
            href={APP_ROUTES.marketplace}
          >
            Creator packages
          </Link>
        </nav>
      </div>
    </header>
  );
}
