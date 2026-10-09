export const APP_ROUTES = {
  login: "/login",
  marketplace: "/marketplace",
  dashboard: "/dashboard",
  admin: "/admin",
  builder: "/packages/new",
  manualBuilder: "/packages/new/manual",
  wizard: "/packages/new/ai",
} as const;

export type AppScreen = keyof typeof APP_ROUTES;

export function routeFor(screen: AppScreen): string {
  return APP_ROUTES[screen];
}

export function creatorPackageRoute(packageId: string, status: string): string {
  const encodedId = encodeURIComponent(packageId);

  if (status === "live") return `/marketplace/packages/${encodedId}`;
  if (status === "approved") return `/packages/preview/${encodedId}`;
  return `/packages/editor/${encodedId}`;
}

/**
 * Where "back" leads from a creator's package preview. A draft or rejected
 * package is previewed from its editor, so back returns there; an approved
 * package is previewed from the dashboard row, so back returns there.
 */
export function creatorPreviewBack(packageId: string, status: string | null | undefined): { href: string; label: string } {
  if (status === "draft" || status === "rejected") {
    return { href: `/packages/editor/${encodeURIComponent(packageId)}`, label: "Back to editor" };
  }
  return { href: APP_ROUTES.dashboard, label: "Back to dashboard" };
}

export function adminApprovalRoute(packageId: string): string {
  return `/admin/approvals/${encodeURIComponent(packageId)}`;
}

export function creatorPackageShareRoute(packageId: string, status: string): string | null {
  if (status !== "live") return null;
  return `/marketplace/packages/${encodeURIComponent(packageId)}`;
}
