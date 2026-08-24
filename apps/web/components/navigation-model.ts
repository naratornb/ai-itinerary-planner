import { APP_ROUTES } from "../lib/routes";

export const creatorNavigationItems = [
  { label: "Dashboard", icon: "dashboard", href: APP_ROUTES.dashboard },
  { label: "My packages", icon: "luggage", href: APP_ROUTES.builder },
] as const;

export const marketplaceNavigationItems = [
  "Flights",
  "Stays",
  "Tours",
  "Deals",
] as const;
