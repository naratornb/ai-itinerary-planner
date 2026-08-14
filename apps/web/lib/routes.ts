export const APP_ROUTES = {
  login: "/login",
  marketplace: "/marketplace",
  dashboard: "/dashboard",
  builder: "/packages/new",
  wizard: "/packages/new/ai",
  editor: "/packages/editor",
} as const;

export type AppScreen = keyof typeof APP_ROUTES;

export function routeFor(screen: AppScreen): string {
  return APP_ROUTES[screen];
}
