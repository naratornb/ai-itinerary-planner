"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { DEFAULT_DEMO_STATE, parseDemoState } from "../lib/demo-state";
import type { EditorState } from "../lib/ai/itinerary";

const STORAGE_KEY = "marketplace-demo-state";
const ITINERARY_KEY = "marketplace-generated-itinerary";

type DemoStateContextValue = {
  hasBuiltTrip: boolean;
  wizardStep: number;
  setHasBuiltTrip: (value: boolean) => void;
  setWizardStep: (value: number) => void;

  /** Result of the last AI build. null means the user is building manually. */
  generatedItinerary: EditorState | null;
  setGeneratedItinerary: (value: EditorState | null) => void;
};

const DemoStateContext = createContext<DemoStateContextValue | null>(null);

function readStoredItinerary(): EditorState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ITINERARY_KEY);
    return raw ? (JSON.parse(raw) as EditorState) : null;
  } catch {
    return null;
  }
}

export function DemoStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(() =>
    typeof window === "undefined"
      ? DEFAULT_DEMO_STATE
      : parseDemoState(window.sessionStorage.getItem(STORAGE_KEY)),
  );

  const [generatedItinerary, setItinerary] = useState<EditorState | null>(readStoredItinerary);

  useEffect(() => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (generatedItinerary) {
      window.sessionStorage.setItem(ITINERARY_KEY, JSON.stringify(generatedItinerary));
    } else {
      window.sessionStorage.removeItem(ITINERARY_KEY);
    }
  }, [generatedItinerary]);

  return (
    <DemoStateContext.Provider
      value={{
        ...state,
        setHasBuiltTrip: (hasBuiltTrip) => setState((current) => ({ ...current, hasBuiltTrip })),
        setWizardStep: (wizardStep) =>
          setState((current) => ({
            ...current,
            wizardStep: Math.min(3, Math.max(0, wizardStep)),
          })),
        generatedItinerary,
        setGeneratedItinerary: setItinerary,
      }}
    >
      {children}
    </DemoStateContext.Provider>
  );
}

export function useDemoState() {
  const context = useContext(DemoStateContext);
  if (!context) throw new Error("useDemoState must be used inside DemoStateProvider");
  return context;
}
