import Link from "next/link";

import { APP_ROUTES } from "../../lib/routes";
import { MarketplaceBrandLogo } from "../migrated-screens";

// Same red bar as the creator header (CreatorNav), with an "Admin Hub" tag
// where the creator side says "Creator Hub".
export function AdminHeader({ onSignOut }: { onSignOut: () => void }) {
  return (
    <header className="admin-review-header">
      <div className="admin-review-header__brand">
        <Link href={APP_ROUTES.marketplace} aria-label="Travel Marketplace">
          <MarketplaceBrandLogo />
        </Link>
        <span className="admin-review-context">Admin Hub</span>
      </div>
      <button type="button" onClick={onSignOut}>Sign out</button>
    </header>
  );
}
