"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { DEFAULT_DEMO_STATE, parseDemoState } from "../lib/demo-state";

const STORAGE_KEY = "marketplace-demo-state";

type DemoStateContextValue = {
  hasBuiltTrip: boolean;
  wizardStep: number;
  setHasBuiltTrip: (value: boolean) => void;
  setWizardStep: (value: number) => void;
};

const DemoStateContext = createContext<DemoStateContextValue | null>(null);

export function DemoStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(() =>
    typeof window === "undefined"
      ? DEFAULT_DEMO_STATE
      : parseDemoState(window.sessionStorage.getItem(STORAGE_KEY)),
  );

  useEffect(() => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

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
