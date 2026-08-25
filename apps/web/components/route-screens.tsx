"use client";

import { useState } from "react";
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
import { generateItinerary, type WizardSelection } from "../lib/ai/itinerary";
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
  const { setGeneratedItinerary } = useDemoState();

  return (
    <>
      <CreatorNav activeItem="My Packages" onItem={() => undefined} onNav={onNav} />
      <BuilderScreen
        onNav={(screen) => {
          // Manual build: clear any stale AI result so the editor falls back
          // to its own defaults.
          if (screen === "editor") setGeneratedItinerary(null);
          onNav(screen);
        }}
      />
    </>
  );
}

export function WizardRouteScreen() {
  const onNav = useScreenNavigation();
  const {
    hasBuiltTrip, setHasBuiltTrip, wizardStep, setGeneratedItinerary,
  } = useDemoState();
  const [buildError, setBuildError] = useState<string | null>(null);

  const handleBuild = async (selection: WizardSelection) => {
    setBuildError(null);
    try {
      const editorState = await generateItinerary(selection);
      setGeneratedItinerary(editorState);
      setHasBuiltTrip(true);
      onNav("editor");
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : "Build failed");
      throw error;              // lets the wizard drop out of its loading state
    }
  };

  return (
    <>
      <CreatorNav activeItem="My Packages" onItem={() => undefined} onNav={onNav} />
      {buildError && (
        <div role="alert" style={{
          maxWidth: 960, margin: "16px auto 0", padding: "12px 16px",
          borderRadius: 8, background: "#FDECEA", color: "#C62828", fontSize: 14,
        }}>
          Could not build the trip: {buildError}
        </div>
      )}
      <AIWizardScreen
        hasBuilt={hasBuiltTrip}
        initialStep={wizardStep}
        onBuild={handleBuild}
        onNav={(screen) => {
          if (screen === "editor") setHasBuiltTrip(true);
          onNav(screen);
        }}
        requestedStep={wizardStep}
        stepRequestId={wizardStep}
      />
    </>
  );
}
