import { APP_ROUTES } from "../lib/routes";

export const creatorDashboardBackLink = {
  label: "Back to dashboard",
  href: APP_ROUTES.dashboard,
} as const;

export const marketplaceNavigationItems = [
  "Flights",
  "Stays",
  "Tours",
  "Deals",
] as const;

export const dashboardActionAlignment = {
  header: "center",
  buttons: "center",
} as const;
