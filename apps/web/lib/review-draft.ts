import type { BuilderDay } from "./itinerary-builder";

/**
 * The Finalise & Review page reads/writes these through window.sessionStorage
 * directly (see demo-state.ts for the same split: parsing stays pure and
 * testable, storage access stays in the client component).
 */

export type ReviewDraft = {
  description: string;
  coverMediaId: string | null;
};

export const DEFAULT_REVIEW_DRAFT: ReviewDraft = { description: "", coverMediaId: null };

export function reviewDraftStorageKey(packageId: string): string {
  return `package-review-draft:${packageId}`;
}

export function parseReviewDraft(value: string | null): ReviewDraft {
  if (!value) return DEFAULT_REVIEW_DRAFT;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return DEFAULT_REVIEW_DRAFT;
    const candidate = parsed as Partial<ReviewDraft>;
    return {
      description: typeof candidate.description === "string" ? candidate.description : "",
      coverMediaId: typeof candidate.coverMediaId === "string" ? candidate.coverMediaId : null,
    };
  } catch {
    return DEFAULT_REVIEW_DRAFT;
  }
}

export type WizardVibesDraft = {
  vibes: string[];
  season: string | null;
};

export function wizardVibesStorageKey(packageId: string): string {
  return `package-wizard-vibes:${packageId}`;
}

/** Written once by the AI wizard right after it creates the package (see migrated-screens.tsx). */
export function parseWizardVibesDraft(value: string | null): WizardVibesDraft | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<WizardVibesDraft>;
    if (!Array.isArray(candidate.vibes) || !candidate.vibes.every((vibe) => typeof vibe === "string")) return null;
    return { vibes: candidate.vibes, season: typeof candidate.season === "string" ? candidate.season : null };
  } catch {
    return null;
  }
}

export type ItinerarySnapshot = {
  title: string;
  days: BuilderDay[];
};

export function itinerarySnapshotStorageKey(packageId: string): string {
  return `package-itinerary-snapshot:${packageId}`;
}

/**
 * Belt-and-braces handover from the editor to the review page: the editor
 * writes its working days/title right before navigating here so review shows
 * exactly what was on screen, without re-fetching (and without depending on
 * every in-flight field surviving the PUT → GET round-trip). Falls back to
 * the fetched package on a direct visit.
 */
export function parseItinerarySnapshot(value: string | null): ItinerarySnapshot | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<ItinerarySnapshot>;
    if (typeof candidate.title !== "string" || !Array.isArray(candidate.days)) return null;
    return { title: candidate.title, days: candidate.days as BuilderDay[] };
  } catch {
    return null;
  }
}
