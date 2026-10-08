"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { DEFAULT_DEMO_STATE, parseDemoState } from "../lib/demo-state";

const STORAGE_KEY = "marketplace-demo-state";

type DemoStateContextValue = {
  wizardStep: number;
  setWizardStep: (value: number) => void;
};

const DemoStateContext = createContext<DemoStateContextValue | null>(null);

export function DemoStateProvider({ children }: { children: React.ReactNode }) {
  // Storage is read in an effect, not a lazy initializer: the initializer
  // would run on the server (default) and on the client (stored value) and
  // produce different first-render trees — a hydration mismatch.
  const [state, setState] = useState(DEFAULT_DEMO_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(parseDemoState(window.sessionStorage.getItem(STORAGE_KEY)));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  return (
    <DemoStateContext.Provider
      value={{
        ...state,
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
