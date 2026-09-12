export const APP_ROUTES = {
  login: "/login",
  marketplace: "/marketplace",
  dashboard: "/dashboard",
  builder: "/packages/new",
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
