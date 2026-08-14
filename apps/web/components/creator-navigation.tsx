"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { creatorNavigationItems } from "./navigation-model";
import { APP_ROUTES } from "../lib/routes";

export function CreatorNavigation() {
  const pathname = usePathname();

  return (
    <aside className="creator-nav">
      <Link className="creator-nav__brand" href={APP_ROUTES.marketplace}>
        <span aria-hidden="true">✦</span>
        <strong>Creator Studio</strong>
      </Link>
      <nav aria-label="Creator navigation">
        {creatorNavigationItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.label === "My packages" && pathname.startsWith("/packages"));
          return (
            <Link className={active ? "active" : undefined} href={item.href} key={item.label}>
              <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="creator-nav__profile">
        <span className="creator-avatar">EC</span>
        <div><strong>Emma Chen</strong><small>Travel creator</small></div>
      </div>
    </aside>
  );
}
