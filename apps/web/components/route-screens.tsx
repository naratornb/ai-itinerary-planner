"use client";

import { useRouter } from "next/navigation";

import { useDemoState } from "./demo-state";
import {
  AIWizardScreen,
  BuilderScreen,
  CreatorNav,
  DashboardScreen,
  LoginScreen,
  MarketplaceScreen,
  TopNav,
  type Screen,
} from "./migrated-screens";
import { APP_ROUTES } from "../lib/routes";

const SCREEN_ROUTES: Record<Screen, string> = {
  login: APP_ROUTES.login,
  marketplace: APP_ROUTES.marketplace,
  dashboard: APP_ROUTES.dashboard,
  builder: APP_ROUTES.builder,
  "ai-wizard": APP_ROUTES.wizard,
  editor: APP_ROUTES.editor,
};

function useScreenNavigation() {
  const router = useRouter();
  return (screen: Screen) => router.push(SCREEN_ROUTES[screen]);
}

export function LoginRouteScreen() {
  return <LoginScreen onNav={useScreenNavigation()} />;
}

export function MarketplaceRouteScreen() {
  const onNav = useScreenNavigation();
  return <><TopNav screen="marketplace" onNav={onNav} /><MarketplaceScreen /></>;
}

export function DashboardRouteScreen() {
  const onNav = useScreenNavigation();
  return <><CreatorNav activeItem="Dashboard" onItem={() => undefined} onNav={onNav} /><DashboardScreen onNav={onNav} /></>;
}

export function BuilderRouteScreen() {
  const onNav = useScreenNavigation();
  return <><CreatorNav activeItem="My Packages" onItem={() => undefined} onNav={onNav} /><BuilderScreen onNav={onNav} /></>;
}

export function WizardRouteScreen() {
  const onNav = useScreenNavigation();
  const { hasBuiltTrip, setHasBuiltTrip, wizardStep } = useDemoState();

  return <><CreatorNav activeItem="My Packages" onItem={() => undefined} onNav={onNav} /><AIWizardScreen
    hasBuilt={hasBuiltTrip}
    initialStep={wizardStep}
    onNav={(screen) => {
      if (screen === "editor") setHasBuiltTrip(true);
      onNav(screen);
    }}
    requestedStep={wizardStep}
    stepRequestId={wizardStep}
  /></>;
}
