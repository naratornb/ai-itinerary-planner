"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { hasAdminApprovalAccess } from "../lib/admin-api";
import { supabase } from "../lib/supabase/client";

const DASHBOARD_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const SCREEN_ROUTES: Record<Screen, string> = {
  login: APP_ROUTES.login,
  marketplace: APP_ROUTES.marketplace,
  dashboard: APP_ROUTES.dashboard,
  admin: APP_ROUTES.admin,
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

export async function dashboardRouteDecision(
  fetcher: typeof fetch,
  apiUrl: string,
  accessToken: string | null | undefined,
): Promise<string> {
  if (!accessToken) return APP_ROUTES.login;
  return await hasAdminApprovalAccess(fetcher, apiUrl, accessToken)
    ? APP_ROUTES.admin
    : APP_ROUTES.dashboard;
}

export function DashboardRouteScreen() {
  const router = useRouter();
  const onNav = useScreenNavigation();
  const [creatorReady, setCreatorReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(async ({ data }) => {
      try {
        const destination = await dashboardRouteDecision(
          fetch,
          DASHBOARD_API_URL,
          data.session?.access_token,
        );
        if (cancelled) return;
        if (destination !== APP_ROUTES.dashboard) {
          router.replace(destination);
          return;
        }
        setCreatorReady(true);
      } catch {
        if (!cancelled) router.replace(APP_ROUTES.login);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!creatorReady) {
    return (
      <main className="editor-load-state" aria-busy="true">
        <span className="editor-load-spinner" aria-hidden="true" />
        <p>Checking access…</p>
      </main>
    );
  }

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

export function WizardRouteScreen() {
  const onNav = useScreenNavigation();
  const { wizardStep } = useDemoState();

  return <><CreatorNav onNav={onNav} /><AIWizardScreen
    initialStep={wizardStep}
    onNav={onNav}
    requestedStep={wizardStep}
    stepRequestId={wizardStep}
  /></>;
}
