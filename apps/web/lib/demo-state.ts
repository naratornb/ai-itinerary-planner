export type StoredDemoState = {
  hasBuiltTrip: boolean;
  wizardStep: number;
};

export const DEFAULT_DEMO_STATE: StoredDemoState = {
  hasBuiltTrip: false,
  wizardStep: 0,
};

export function parseDemoState(value: string | null): StoredDemoState {
  if (!value) return DEFAULT_DEMO_STATE;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return DEFAULT_DEMO_STATE;

    const candidate = parsed as Partial<StoredDemoState>;
    const wizardStep =
      typeof candidate.wizardStep === "number" && Number.isInteger(candidate.wizardStep)
        ? Math.min(3, Math.max(0, candidate.wizardStep))
        : 0;

    return {
      hasBuiltTrip: candidate.hasBuiltTrip === true,
      wizardStep,
    };
  } catch {
    return DEFAULT_DEMO_STATE;
  }
}
