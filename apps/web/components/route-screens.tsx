"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
  "manual-builder": APP_ROUTES.manualBuilder,
  "ai-wizard": APP_ROUTES.wizard,
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

export function MarketplaceRouteNav() {
  return <TopNav screen="marketplace" onNav={useScreenNavigation()} />;
}

export function DashboardRouteScreen() {
  const onNav = useScreenNavigation();
  return <><CreatorNav onNav={onNav} /><DashboardScreen onNav={onNav} /></>;
}

export function BuilderRouteScreen() {
  const onNav = useScreenNavigation();
  return <><CreatorNav onNav={onNav} /><BuilderScreen onNav={onNav} /></>;
}

export function ManualBuilderRouteScreen() {
  const onNav = useScreenNavigation();
  return <><CreatorNav onNav={onNav} /><AIWizardScreen onNav={onNav} variant="manual" /></>;
}

function WizardRouteScreenInner() {
  const onNav = useScreenNavigation();
  const { wizardStep } = useDemoState();
  const editPackageId = useSearchParams().get("edit");

  return <><CreatorNav onNav={onNav} /><AIWizardScreen
    initialStep={wizardStep}
    onNav={onNav}
    requestedStep={wizardStep}
    stepRequestId={wizardStep}
    editPackageId={editPackageId}
  /></>;
}

export function WizardRouteScreen() {
  return <Suspense fallback={null}><WizardRouteScreenInner /></Suspense>;
}
